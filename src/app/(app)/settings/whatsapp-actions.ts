"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { fetchTemplateCatalog } from "@/lib/wa-business";
import { persistTemplateCatalog } from "@/lib/wa-templates";
import { logActivity } from "@/lib/activity";
import { setFlash } from "@/lib/flash";

export interface SyncResult {
  ok: boolean;
  /** Number of templates Meta returned (across all pages). */
  fetched?: number;
  /** Templates removed because they're no longer in Meta's catalog. */
  pruned?: number;
  reason?: string;
}

/**
 * OWNER-only — refresh the local WhatsAppTemplate mirror against Meta.
 *
 * Walks GET /v21.0/<wabaId>/message_templates, upserts every entry into
 * the local table, then prunes any local row whose (name, language)
 * pair no longer appears in the upstream result (template deleted
 * from Meta Business Manager). Idempotent — re-running is safe and
 * fast (the diff is minimal once the catalog stabilises).
 *
 * Failure modes are all operator-visible: missing credentials → toast,
 * Meta auth error → toast with the upstream message.
 */
export async function syncWhatsappTemplates(): Promise<SyncResult> {
  const user = await requireCompanyUser();
  if (user.role !== "OWNER") {
    return { ok: false, reason: "Only the company owner can sync templates." };
  }

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: {
      whatsappBusinessAccountId: true,
      whatsappAccessToken: true,
    },
  });
  if (!company?.whatsappBusinessAccountId || !company?.whatsappAccessToken) {
    return {
      ok: false,
      reason: "Set the WhatsApp Business Account ID and access token first.",
    };
  }

  const token = decryptSecret(company.whatsappAccessToken);
  if (!token) {
    return {
      ok: false,
      reason: "Access token failed to decrypt — re-save it in Settings → Integrations.",
    };
  }

  const result = await fetchTemplateCatalog({
    wabaId: company.whatsappBusinessAccountId,
    accessToken: token,
  });
  if (!result.ok) {
    return { ok: false, reason: `Meta ${result.status}: ${result.error}` };
  }

  const { pruned } = await persistTemplateCatalog(user.companyId, result.templates);

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "whatsapp.templates_synced",
    entityType: "COMPANY",
    entityId: user.companyId,
    summary: `Synced ${result.templates.length} WhatsApp template(s); pruned ${pruned}.`,
    meta: { fetched: result.templates.length, pruned },
  });
  await setFlash({ tone: "ok", message: `Synced ${result.templates.length} template(s).` });
  revalidatePath("/settings");

  return { ok: true, fetched: result.templates.length, pruned };
}
