import type { WaAutomationEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendCompanyTemplate, whatsAppAvailable } from "@/lib/wa-send";

/**
 * Send an automated message through the company's mapped Meta-approved template
 * for `event`. Templates are the only way to reach a recipient OUTSIDE Meta's
 * 24-hour customer-service window (a free-form text would be rejected), so this
 * is what makes cold automated sends — contract links, etc. — actually deliver.
 *
 * Returns `configured: false` when there's no template mapping for the event or
 * WhatsApp isn't connected, so the caller can fall back to its prior behaviour
 * (free-form within the window, or sharing the link manually) without treating
 * "not set up" as an error.
 */
export type AutomationSendResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: string; configured: boolean };

export async function sendAutomationTemplate(input: {
  companyId: string;
  event: WaAutomationEvent;
  toPhone: string;
  /** Positional body params for the template's {{1}}, {{2}}, … placeholders. */
  bodyParams: string[];
}): Promise<AutomationSendResult> {
  const mapping = await prisma.whatsAppAutomation.findUnique({
    where: { companyId_event: { companyId: input.companyId, event: input.event } },
    select: { templateName: true, language: true },
  });

  if (!mapping) {
    return { ok: false, reason: "No template mapped for this event.", configured: false };
  }
  if (!(await whatsAppAvailable(input.companyId))) {
    return { ok: false, reason: "WhatsApp isn't connected for this company.", configured: false };
  }

  // Prefers the QR-linked session (renders the template body to text); else the
  // Cloud API template send.
  const res = await sendCompanyTemplate(
    input.companyId,
    input.toPhone,
    mapping.templateName,
    mapping.language,
    input.bodyParams,
  );
  // configured: true — a mapping + creds existed, so a failure here is a real
  // send error (bad params, template paused, rate limit) worth surfacing.
  return res.ok
    ? { ok: true, messageId: res.messageId }
    : { ok: false, reason: res.error, configured: true };
}
