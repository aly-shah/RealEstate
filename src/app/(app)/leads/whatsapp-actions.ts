"use server";

import { requireCompanyUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { enqueueJob, JOB_TYPES } from "@/lib/jobs";
import { logActivity } from "@/lib/activity";
import { isConnected } from "@/lib/wa-qr/manager";

export interface SendResult {
  ok: boolean;
  jobId?: string;
  reason?: string;
}

/**
 * Phase-9.5 outbound WhatsApp send. Validates the lead belongs to the
 * caller's tenant, confirms the tenant has both halves of the Meta
 * credentials configured, then enqueues a WHATSAPP_OUTBOUND job.
 *
 * The job runner handles the actual graph.facebook.com call so this
 * action returns instantly — the UI shows "Send queued" toast and the
 * activity timeline updates within a tick (one minute) once Meta
 * acknowledges. Failures are visible in /admin/jobs.
 *
 * maxAttempts is set to 1 because most send failures (recipient not
 * on WhatsApp, 24h-window closed, invalid token) are not transient.
 * The operator sees the failure in the timeline and fixes the root
 * cause rather than letting the queue burn the retry budget.
 */
export async function sendWhatsAppMessage(
  leadId: string,
  body: string,
): Promise<SendResult> {
  const user = await requireCompanyUser();

  const trimmed = body.trim();
  if (!trimmed) return { ok: false, reason: "Message body is empty." };
  if (trimmed.length > 1_000) {
    return { ok: false, reason: "Message exceeds 1,000 characters." };
  }

  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      companyId: user.companyId,
      ...(user.role === "AGENT" ? { agentId: user.id } : {}),
    },
    select: { id: true, client: { select: { phone: true } } },
  });
  if (!lead) return { ok: false, reason: "Lead not found." };
  if (!lead.client?.phone) {
    return { ok: false, reason: "This lead's client has no phone number." };
  }

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { whatsappPhoneId: true, whatsappAccessToken: true },
  });
  const hasCloud = !!company?.whatsappPhoneId && !!company?.whatsappAccessToken;
  if (!hasCloud && !isConnected(user.companyId)) {
    return {
      ok: false,
      reason: "WhatsApp isn't connected for this workspace. Link it (QR or Business API) in Settings.",
    };
  }

  const jobId = await enqueueJob({
    type: JOB_TYPES.WHATSAPP_OUTBOUND,
    companyId: user.companyId,
    payload: { kind: "text", toPhone: lead.client.phone, body: trimmed, leadId: lead.id },
    // Send failures are usually operator-actionable rather than transient;
    // a single attempt + clear timeline entry is more useful than three
    // identical retries spaced minutes apart.
    maxAttempts: 1,
  });

  // Pre-log so the operator sees "queued" before the runner picks it up
  // — gives immediate UI feedback without waiting for the job to tick.
  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "whatsapp.send_queued",
    entityType: "LEAD",
    entityId: lead.id,
    summary: `Queued WhatsApp send to ${lead.client.phone}`,
    meta: { jobId, kind: "text", preview: trimmed.slice(0, 80) },
  });

  return { ok: true, jobId };
}

export interface TemplateSendInput {
  templateName: string;
  language: string;
  bodyParams: string[];
  /**
   * TEXT-header parameters when the template has one. Empty array when
   * the template has no header or no header variables.
   */
  headerParams?: string[];
}

/**
 * Send via a pre-approved Meta template — works outside the 24-hour
 * customer-service window where free-form text is rejected. The operator
 * supplies the template name (matching one approved in Meta Business
 * Manager) + the positional body parameters; Meta substitutes them into
 * the template's {{N}} placeholders in order. Same tenant/credentials
 * guards as the text variant.
 */
export async function sendWhatsAppTemplate(
  leadId: string,
  input: TemplateSendInput,
): Promise<SendResult> {
  const user = await requireCompanyUser();

  const name = input.templateName.trim();
  const language = input.language.trim();
  if (!name) return { ok: false, reason: "Template name is required." };
  if (!language) return { ok: false, reason: "Language code is required (e.g. en, en_US, ur)." };

  // Meta caps body parameters at 1,024 chars each + the per-param shape
  // we enforce in lib/wa-business.ts; here we just bound the count to
  // keep the payload size sane.
  if (input.bodyParams.length > 20) {
    return { ok: false, reason: "Too many body parameters (max 20)." };
  }
  if ((input.headerParams?.length ?? 0) > 5) {
    return { ok: false, reason: "Too many header parameters (max 5)." };
  }

  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      companyId: user.companyId,
      ...(user.role === "AGENT" ? { agentId: user.id } : {}),
    },
    select: { id: true, client: { select: { phone: true } } },
  });
  if (!lead) return { ok: false, reason: "Lead not found." };
  if (!lead.client?.phone) {
    return { ok: false, reason: "This lead's client has no phone number." };
  }

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { whatsappPhoneId: true, whatsappAccessToken: true },
  });
  const hasCloud = !!company?.whatsappPhoneId && !!company?.whatsappAccessToken;
  if (!hasCloud && !isConnected(user.companyId)) {
    return {
      ok: false,
      reason: "WhatsApp isn't connected for this workspace. Link it (QR or Business API) in Settings.",
    };
  }

  const jobId = await enqueueJob({
    type: JOB_TYPES.WHATSAPP_OUTBOUND,
    companyId: user.companyId,
    payload: {
      kind: "template",
      toPhone: lead.client.phone,
      templateName: name,
      language,
      bodyParams: input.bodyParams.map((p) => String(p).slice(0, 1_024)),
      headerParams: (input.headerParams ?? []).map((p) => String(p).slice(0, 1_024)),
      leadId: lead.id,
    },
    maxAttempts: 1,
  });

  await logActivity({
    companyId: user.companyId,
    userId: user.id,
    action: "whatsapp.send_queued",
    entityType: "LEAD",
    entityId: lead.id,
    summary: `Queued WhatsApp template "${name}" to ${lead.client.phone}`,
    meta: { jobId, kind: "template", templateName: name, language, paramCount: input.bodyParams.length },
  });

  return { ok: true, jobId };
}
