"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";
import { parseCsv } from "@/lib/csv";

const KNOWN_SOURCES = new Set([
  "REFERRAL", "WALK_IN", "SOCIAL_MEDIA", "PORTAL", "CALL", "REPEAT_CLIENT", "OTHER",
]);

const KNOWN_PORTALS = new Set(["ZAMEEN", "GRAANA", "OLX", "FACEBOOK", "CSV"]);

export interface ImportResult {
  /** Total non-empty data rows seen in the CSV (excludes header). */
  total: number;
  /** Leads actually inserted. */
  created: number;
  /** Rows skipped because they matched an existing client AND lead was a duplicate. */
  reused: number;
  /** Rows rejected (per-row reason captured below). */
  errors: { row: number; reason: string }[];
}

export interface FormState {
  error?: string;
  result?: ImportResult;
}

/**
 * Bulk-import leads from a CSV the user pastes / uploads. Office-only.
 *
 * Expected header columns (all case-insensitive, all optional except name):
 *   name, phone, email, source, budgetMin, budgetMax, prefArea, requirements
 *
 * Reuses the same de-dup logic as createLead — if a client with the same
 * phone OR email already exists, we link the new Lead to that client instead
 * of creating a duplicate. importSource is set to the chosen portal so the
 * later reporting can attribute conversion by channel.
 */
export async function importLeadsFromCsv(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireCompanyUser();
  if (!can(user.role, "assignLeadsCalendars")) return { error: "Not allowed." };

  const rawPortal = String(formData.get("portal") || "").toUpperCase();
  const portal = KNOWN_PORTALS.has(rawPortal) ? rawPortal : "CSV";

  // Two input paths: a pasted textarea or an uploaded file. Whichever is
  // populated wins — keeps the form simple.
  let csvText = String(formData.get("csv") || "").trim();
  const file = formData.get("file");
  if (!csvText && file instanceof File && file.size > 0) {
    if (file.size > 2 * 1024 * 1024) {
      return { error: "CSV file too large (2 MB cap). Trim or split it." };
    }
    csvText = (await file.text()).trim();
  }
  if (!csvText) return { error: "Paste CSV text or attach a .csv file." };

  let parsed;
  try {
    parsed = parseCsv(csvText);
  } catch {
    return { error: "Could not parse the CSV. Check quoting + line breaks." };
  }
  if (parsed.rows.length === 0) {
    return { error: "No data rows found (only a header row, or empty file)." };
  }

  // Case-insensitive lookup of the expected columns. Reject the whole file
  // if "name" is missing — without it we can't make a usable lead.
  const headerMap = new Map<string, string>(
    parsed.headers.map((h) => [h.toLowerCase().trim(), h]),
  );
  const get = (row: Record<string, string>, key: string) => {
    const real = headerMap.get(key);
    return real ? row[real]?.trim() : "";
  };
  if (!headerMap.has("name")) {
    return { error: "CSV must include a 'name' column." };
  }

  const result: ImportResult = { total: parsed.rows.length, created: 0, reused: 0, errors: [] };

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const lineNo = i + 2; // +1 for header, +1 to make it 1-indexed for humans

    const name = get(row, "name");
    if (!name || name.length < 2) {
      result.errors.push({ row: lineNo, reason: "Missing or too-short name" });
      continue;
    }

    const phone = get(row, "phone") || null;
    const email = get(row, "email")?.toLowerCase() || null;
    const sourceRaw = (get(row, "source") || "PORTAL").toUpperCase();
    const source = KNOWN_SOURCES.has(sourceRaw) ? sourceRaw : "PORTAL";
    const budgetMin = Number(get(row, "budgetmin") || "") || null;
    const budgetMax = Number(get(row, "budgetmax") || "") || null;
    const prefArea = get(row, "prefarea") || null;
    const requirements = get(row, "requirements") || null;

    try {
      // Re-use the createLead de-dup pattern (phone/email match within tenant).
      let client = null as Awaited<ReturnType<typeof prisma.client.findFirst>>;
      let reusedExisting = false;
      if (phone || email) {
        client = await prisma.client.findFirst({
          where: {
            companyId: user.companyId,
            OR: [
              ...(phone ? [{ phone }] : []),
              ...(email ? [{ email }] : []),
            ],
          },
          orderBy: { createdAt: "desc" },
        });
      }
      if (client) {
        reusedExisting = true;
      } else {
        client = await prisma.client.create({
          data: { companyId: user.companyId, name, phone, email },
        });
      }

      await prisma.lead.create({
        data: {
          companyId: user.companyId,
          clientId: client!.id,
          // Imports land unassigned — admins triage from the leads list. This
          // also means the auto-followup helper deliberately skips them.
          agentId: null,
          source: source as "REFERRAL" | "WALK_IN" | "SOCIAL_MEDIA" | "PORTAL" | "CALL" | "REPEAT_CLIENT" | "OTHER",
          budgetMin: budgetMin != null ? new Prisma.Decimal(budgetMin) : null,
          budgetMax: budgetMax != null ? new Prisma.Decimal(budgetMax) : null,
          prefArea,
          requirements,
          importSource: portal,
          notes: `Imported from ${portal}${reusedExisting ? " (existing client)" : ""}`,
        },
      });

      if (reusedExisting) result.reused += 1;
      result.created += 1;
    } catch (e) {
      result.errors.push({
        row: lineNo,
        reason: e instanceof Error ? e.message.slice(0, 200) : "Unknown error",
      });
    }
  }

  if (result.created > 0) {
    await logActivity({
      companyId: user.companyId,
      userId: user.id,
      action: "lead.imported",
      entityType: "LEAD",
      summary: `Imported ${result.created} leads from ${portal}${result.reused ? ` (${result.reused} reused existing clients)` : ""}`,
      meta: {
        portal,
        total: result.total,
        created: result.created,
        reused: result.reused,
        errors: result.errors.length,
      },
    });
  }

  revalidatePath("/leads");
  return { result };
}
