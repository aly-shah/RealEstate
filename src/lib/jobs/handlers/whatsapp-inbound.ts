import type { JobHandler } from "@/lib/jobs/types";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { classifyInboundWhatsApp } from "@/lib/ai/handlers/whatsapp-classify";

/**
 * Phase-9 inbound WhatsApp handler.
 *
 * Tenant routing happens at the webhook layer: the route looks up the
 * `phone_number_id` from the payload against `Company.whatsappPhoneId`
 * and enqueues with the resolved companyId (or null when the line isn't
 * claimed yet — those land at the platform level for ops to triage).
 * Classification still runs in both cases so the inbox view shows
 * parsed intents either way.
 *
 * Idempotency is handled upstream: the webhook enqueues with
 * `idempotencyKey = wamid`, and enqueueJob returns the existing job id on
 * Meta's retries — so this handler never sees the same message twice in
 * practice.
 */
export const whatsappInboundHandler: JobHandler = async ({ payload, companyId }) => {
  const p = (payload ?? {}) as Record<string, unknown>;
  const from = typeof p.from === "string" ? p.from.slice(0, 40) : null;
  const text = typeof p.text === "string" ? p.text.slice(0, 1_000) : null;

  // Classify if we have text and a model. classifyInboundWhatsApp is
  // fail-safe — returns null when ANTHROPIC_API_KEY is missing or the
  // call errors, never throws — so the handler keeps working even when
  // AI is unavailable.
  const classification = text ? await classifyInboundWhatsApp(text) : null;

  if (companyId) {
    await prisma.activityLog.create({
      data: {
        companyId,
        action: "whatsapp.inbound",
        entityType: "WHATSAPP",
        summary: buildSummary({ from, text, classification }),
        meta: { from, text, raw: p, classification } as unknown as Prisma.InputJsonObject,
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
  };
};

function buildSummary(input: {
  from: string | null;
  text: string | null;
  classification: { intent: string; urgency: string; lead_summary: string } | null;
}): string {
  const base = `Inbound WhatsApp${input.from ? ` from ${input.from}` : ""}`;
  if (input.classification) {
    const c = input.classification;
    return `${base} (${c.intent}/${c.urgency}): ${c.lead_summary.slice(0, 120)}`;
  }
  if (input.text) {
    return `${base}: ${input.text.slice(0, 80)}…`;
  }
  return base;
}
