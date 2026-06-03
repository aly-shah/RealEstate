import type { JobHandler } from "@/lib/jobs/types";
import { prisma } from "@/lib/prisma";

/**
 * Phase-9.5 risk fix — Meta WhatsApp status callback handler.
 *
 * Meta posts a status event per outbound message for each lifecycle
 * transition:  sent → delivered → read  (plus `failed` on errors).
 * We log delivered / read / failed; sent is skipped because we
 * already logged it locally at send-queue time.
 *
 * Payload shape (from the webhook extractor):
 *   { wamid: string, status: "sent"|"delivered"|"read"|"failed",
 *     timestamp?: string, recipientId?: string, error?: string }
 *
 * Tenant routing happens at the webhook layer (same phone_number_id ↔
 * Company lookup as inbound messages), so the handler trusts the
 * companyId on the job row.
 */
export const whatsappStatusHandler: JobHandler = async ({ payload, companyId }) => {
  if (!companyId) {
    // Unknown phone_number_id — drop silently. The webhook surfaces
    // these in /admin/jobs already; no need to error-spam the runner.
    return { skipped: "no tenant routing" };
  }
  const p = (payload ?? {}) as {
    wamid?: string;
    status?: string;
    timestamp?: string;
    recipientId?: string;
    error?: string;
  };
  if (!p.wamid || !p.status) {
    return { skipped: "malformed payload" };
  }

  // Skip the `sent` transition — the send action already logged
  // "whatsapp.send_queued" + the outbound handler logged "whatsapp.sent"
  // when Meta acked the API call. A third row would be timeline noise.
  if (p.status === "sent") return { skipped: "sent already logged at send time" };

  // Cross-reference the matching outbound activity log so the new row
  // shares the entity link (entityType=LEAD / entityId=...) and the
  // lead detail timeline shows delivery progress without extra joins.
  const origin = await prisma.activityLog.findFirst({
    where: {
      companyId,
      action: "whatsapp.sent",
      meta: { path: ["wamid"], equals: p.wamid },
    },
    select: { entityType: true, entityId: true },
    orderBy: { createdAt: "desc" },
  });

  const action =
    p.status === "delivered"
      ? "whatsapp.delivered"
      : p.status === "read"
        ? "whatsapp.read"
        : p.status === "failed"
          ? "whatsapp.delivery_failed"
          : `whatsapp.${p.status}`;

  const summary =
    p.status === "failed"
      ? `WhatsApp delivery failed${p.error ? ": " + p.error.slice(0, 120) : ""}`
      : `WhatsApp ${p.status}${p.recipientId ? " (" + p.recipientId + ")" : ""}`;

  await prisma.activityLog.create({
    data: {
      companyId,
      action,
      entityType: origin?.entityType ?? "WHATSAPP",
      entityId: origin?.entityId ?? null,
      summary,
      meta: { wamid: p.wamid, status: p.status, timestamp: p.timestamp ?? null, error: p.error ?? null },
    },
  });

  return { logged: action };
};
