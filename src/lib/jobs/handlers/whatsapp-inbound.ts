import type { JobHandler } from "@/lib/jobs/types";
import { Prisma } from "@prisma/client";
import type { PropertyType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { classifyInboundWhatsApp, type WhatsAppClassification } from "@/lib/ai/handlers/whatsapp-classify";
import { routeForCompany } from "@/lib/lead-router";
import { normalizePhone } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";

/**
 * Phase-9 inbound WhatsApp handler.
 *
 * Tenant routing happens at the webhook layer: the route looks up the
 * `phone_number_id` from the payload against `Company.whatsappPhoneId`
 * and enqueues with the resolved companyId (or null when the line isn't
 * claimed yet — those land at the platform level for ops to triage).
 *
 * For a claimed line, this now CAPTURES the message as a lead: it classifies
 * the text, finds/creates the Client by phone, creates a Lead with the
 * AI-extracted preferences (type / area / budget), and hands it to the
 * company's lead-routing engine (lib/lead-router.ts) for auto-assignment.
 * Off-topic messages and ongoing conversations with an already-open lead are
 * skipped so the pipeline doesn't fill with noise.
 *
 * Idempotency is handled upstream: the webhook enqueues with
 * `idempotencyKey = wamid`, and enqueueJob returns the existing job id on
 * Meta's retries — so this handler never sees the same message twice.
 */

const PROPERTY_TYPES = new Set<PropertyType>([
  "RESIDENTIAL", "COMMERCIAL", "PLOT", "APARTMENT", "VILLA", "SHOP", "OFFICE",
]);
const CLOSED_STAGES = ["CLOSED_WON", "CLOSED_LOST"] as const;

export const whatsappInboundHandler: JobHandler = async ({ payload, companyId }) => {
  const p = (payload ?? {}) as Record<string, unknown>;
  const from = typeof p.from === "string" ? p.from.slice(0, 40) : null;
  const profileName = typeof p.name === "string" ? p.name.slice(0, 120) : null;
  const text = typeof p.text === "string" ? p.text.slice(0, 1_000) : null;

  // Classify if we have text and a model. classifyInboundWhatsApp is
  // fail-safe — returns null when ANTHROPIC_API_KEY is missing or the
  // call errors, never throws — so the handler keeps working even when
  // AI is unavailable.
  const classification = text ? await classifyInboundWhatsApp(text) : null;

  // Capture as a lead only for a claimed line with a known sender, and skip
  // clearly off-topic chatter when we have a classification to judge by.
  let leadId: string | null = null;
  let leadCreated = false;
  if (companyId && from && (!classification || classification.intent !== "OFF_TOPIC")) {
    const captured = await captureLead({ companyId, from, profileName, text, classification });
    leadId = captured.leadId;
    leadCreated = captured.created;
  }

  if (companyId) {
    await prisma.activityLog.create({
      data: {
        companyId,
        action: "whatsapp.inbound",
        entityType: leadId ? "LEAD" : "WHATSAPP",
        entityId: leadId,
        summary: buildSummary({ from, text, classification, leadCreated }),
        meta: { from, text, raw: p, classification, leadId, leadCreated } as unknown as Prisma.InputJsonObject,
      },
    });
  }

  return {
    handled: true,
    from,
    hasText: !!text,
    classified: !!classification,
    intent: classification?.intent ?? null,
    urgency: classification?.urgency ?? null,
    leadCreated,
    leadId,
  };
};

/**
 * Find/create the Client by phone and create a Lead from the classification —
 * unless the client already has an open lead, in which case the message belongs
 * to that conversation and we just refresh its recency. Routes any new lead.
 */
async function captureLead(input: {
  companyId: string;
  from: string;
  profileName: string | null;
  text: string | null;
  classification: WhatsAppClassification | null;
}): Promise<{ leadId: string | null; created: boolean }> {
  const { companyId, from, profileName, text, classification } = input;

  // Phone variants for dedup — Meta's wa_id is canonical (92…); also try the
  // local 0-prefixed form and the raw value. Exact-match, mirroring createLead.
  const canonical = normalizePhone(from) ?? from;
  const localZero = canonical.startsWith("92") ? `0${canonical.slice(2)}` : canonical;
  const phoneVariants = [...new Set([from, canonical, localZero])];

  let client = await prisma.client.findFirst({
    where: { companyId, phone: { in: phoneVariants } },
    orderBy: { createdAt: "desc" },
  });

  if (client) {
    // Already has an open lead? The message is part of that conversation —
    // refresh its recency instead of creating a duplicate.
    const open = await prisma.lead.findFirst({
      where: { companyId, clientId: client.id, stage: { notIn: [...CLOSED_STAGES] } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (open) {
      await prisma.lead.update({ where: { id: open.id }, data: { updatedAt: new Date() } });
      return { leadId: open.id, created: false };
    }
  } else {
    client = await prisma.client.create({
      data: { companyId, name: profileName || canonical, phone: canonical },
    });
  }

  const prefType =
    classification?.suggested_pref_type && PROPERTY_TYPES.has(classification.suggested_pref_type as PropertyType)
      ? (classification.suggested_pref_type as PropertyType)
      : null;

  const lead = await prisma.lead.create({
    data: {
      companyId,
      clientId: client.id,
      // No WHATSAPP value in the LeadSource enum — record provenance in the
      // free-text importSource tag (alongside ZAMEEN / OLX / CSV).
      source: "OTHER",
      importSource: "WHATSAPP",
      prefType,
      prefArea: classification?.suggested_pref_area ?? null,
      budgetMax:
        classification?.suggested_budget_pkr != null
          ? new Prisma.Decimal(classification.suggested_budget_pkr)
          : null,
      requirements: classification?.lead_summary ?? (text ? text.slice(0, 500) : null),
    },
  });

  await logActivity({
    companyId,
    action: "lead.created",
    entityType: "LEAD",
    entityId: lead.id,
    summary: `New WhatsApp lead — ${client.name}`,
    meta: { source: "WHATSAPP", clientId: client.id, intent: classification?.intent ?? null },
  });

  // Hand to the routing engine (no-op when the company is on MANUAL — the lead
  // then waits in the Unassigned bucket for office triage).
  await routeForCompany(lead.id, companyId);

  return { leadId: lead.id, created: true };
}

function buildSummary(input: {
  from: string | null;
  text: string | null;
  classification: WhatsAppClassification | null;
  leadCreated: boolean;
}): string {
  const base = `Inbound WhatsApp${input.from ? ` from ${input.from}` : ""}`;
  const tail = input.leadCreated ? " → new lead" : "";
  if (input.classification) {
    const c = input.classification;
    return `${base} (${c.intent}/${c.urgency}): ${c.lead_summary.slice(0, 120)}${tail}`;
  }
  if (input.text) {
    return `${base}: ${input.text.slice(0, 80)}…${tail}`;
  }
  return `${base}${tail}`;
}
