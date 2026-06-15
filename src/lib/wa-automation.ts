import type { WaAutomationEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { sendWhatsAppTemplate } from "@/lib/wa-business";

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
  const [mapping, company] = await Promise.all([
    prisma.whatsAppAutomation.findUnique({
      where: { companyId_event: { companyId: input.companyId, event: input.event } },
      select: { templateName: true, language: true },
    }),
    prisma.company.findUnique({
      where: { id: input.companyId },
      select: { whatsappPhoneId: true, whatsappAccessToken: true },
    }),
  ]);

  if (!mapping) {
    return { ok: false, reason: "No template mapped for this event.", configured: false };
  }
  const phoneNumberId = company?.whatsappPhoneId ?? null;
  const accessToken = decryptSecret(company?.whatsappAccessToken);
  if (!phoneNumberId || !accessToken) {
    return { ok: false, reason: "WhatsApp isn't connected for this company.", configured: false };
  }

  const res = await sendWhatsAppTemplate({
    phoneNumberId,
    accessToken,
    toPhone: input.toPhone,
    templateName: mapping.templateName,
    language: mapping.language,
    bodyParams: input.bodyParams,
  });
  // configured: true — a mapping + creds existed, so a failure here is a real
  // send error (bad params, template paused, rate limit) worth surfacing.
  return res.ok
    ? { ok: true, messageId: res.messageId }
    : { ok: false, reason: res.error, configured: true };
}
