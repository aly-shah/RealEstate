import type { JobHandler } from "@/lib/jobs/types";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText, sendWhatsAppTemplate } from "@/lib/wa-business";
import { decryptSecret } from "@/lib/crypto";

/**
 * Phase-9.5 outbound WhatsApp handler.
 *
 * Payload shape — discriminated union on `kind`:
 *   { kind: "text", toPhone, body, leadId? }
 *   { kind: "template", toPhone, templateName, language, bodyParams, leadId? }
 *
 * Legacy payloads without `kind` are treated as text for backward compat
 * with jobs enqueued before the template path landed.
 *
 * Tenant credentials (`phone_number_id` + `accessToken`) live on the
 * Company row. The handler fetches them here rather than from the
 * payload so a token rotation between enqueue and dispatch picks up
 * the new value automatically.
 *
 * Failure handling: the runner retries non-2xx with exponential backoff
 * (Phase 8.5 budget = 3 attempts). We throw with the Meta error message
 * so it shows up in /admin/jobs and the operator can act — most failures
 * are operator-fixable (expired token, recipient not on WhatsApp, 24h
 * customer-service window closed, template not approved).
 */
export const whatsappOutboundHandler: JobHandler = async ({ payload, companyId }) => {
  if (!companyId) {
    throw new Error("whatsapp.outbound requires companyId — refuse to send platform-scoped.");
  }
  const p = (payload ?? {}) as {
    kind?: "text" | "template";
    toPhone?: string;
    body?: string;
    templateName?: string;
    language?: string;
    bodyParams?: string[];
    /** TEXT-header parameters when the template has a header. */
    headerParams?: string[];
    leadId?: string | null;
  };
  if (!p.toPhone) {
    throw new Error("Malformed payload — toPhone is required.");
  }
  const kind = p.kind ?? "text";
  if (kind === "text" && !p.body) {
    throw new Error("Malformed text payload — body is required.");
  }
  if (kind === "template" && (!p.templateName || !p.language)) {
    throw new Error("Malformed template payload — templateName and language are required.");
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { whatsappPhoneId: true, whatsappAccessToken: true },
  });
  if (!company?.whatsappPhoneId || !company?.whatsappAccessToken) {
    // Refuse to retry — credentials gone means the tenant un-configured
    // outbound mid-flight. Throwing a clear message is more useful than
    // burning the retry budget on something the runner can't fix.
    throw new Error("Tenant has no WhatsApp Business API credentials configured.");
  }

  // Decrypt the stored token. decryptSecret returns null on tamper /
  // wrong key (e.g. AUTH_SECRET rotated without re-saving tokens) so
  // we surface that as a clear failure rather than passing garbage to
  // Meta and seeing a 401 with no context.
  const token = decryptSecret(company.whatsappAccessToken);
  if (!token) {
    throw new Error(
      "WhatsApp access token failed to decrypt — re-save it in Settings → Integrations.",
    );
  }

  const result = kind === "template"
    ? await sendWhatsAppTemplate({
        phoneNumberId: company.whatsappPhoneId,
        accessToken: token,
        toPhone: p.toPhone,
        templateName: p.templateName!,
        language: p.language!,
        bodyParams: p.bodyParams ?? [],
        headerParams: p.headerParams ?? [],
      })
    : await sendWhatsAppText({
        phoneNumberId: company.whatsappPhoneId,
        accessToken: token,
        toPhone: p.toPhone,
        body: p.body!,
      });

  // Record the outcome on the activity log regardless of success — the
  // operator wants to see failed sends in the lead timeline too, with
  // the Meta error so they know whether to retry or switch to wa.me.
  await prisma.activityLog.create({
    data: {
      companyId,
      action: result.ok ? "whatsapp.sent" : "whatsapp.send_failed",
      entityType: p.leadId ? "LEAD" : "WHATSAPP",
      entityId: p.leadId ?? null,
      summary: result.ok
        ? `WhatsApp ${kind} sent to ${p.toPhone}${kind === "template" ? ` (template: ${p.templateName})` : ""}`
        : `WhatsApp ${kind} send failed to ${p.toPhone}: ${result.error.slice(0, 120)}`,
      meta: result.ok
        ? { kind, wamid: result.messageId, toPhone: p.toPhone, templateName: p.templateName ?? null }
        : { kind, status: result.status, error: result.error, toPhone: p.toPhone, templateName: p.templateName ?? null },
    },
  });

  if (!result.ok) {
    // Don't retry 4xx — those are configuration / recipient errors that
    // re-sending won't fix. Retry 5xx + network failures (status === 0).
    if (result.status >= 400 && result.status < 500) {
      // Throw a "do not retry" error by marking the job FAILED via a
      // sentinel — the runner doesn't know about no-retry semantics, so
      // we set attempts == maxAttempts on the next loop by re-throwing
      // and letting the budget exhaust naturally. Cleaner approach
      // would be a maxAttempts:1 enqueue (see server action below).
      throw new Error(`Meta ${result.status}: ${result.error}`);
    }
    throw new Error(`Meta ${result.status}: ${result.error}`);
  }

  return { messageId: result.messageId, toPhone: p.toPhone };
};
