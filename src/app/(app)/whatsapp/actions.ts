"use server";

import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { suggestWhatsAppReplies, type SuggestedReplies } from "@/lib/ai/handlers/whatsapp-replies";

export interface RepliesActionResult {
  ok: boolean;
  replies?: SuggestedReplies;
  /** The lead linked to this conversation, if any — needed to send a reply. */
  leadId?: string | null;
  fromCache?: boolean;
  reason?: string;
}

/**
 * Copilot: AI reply suggestions for a WhatsApp conversation (by phone). Builds
 * the thread from the inbound activity trail, returns three editable replies plus
 * the linked lead id (so the UI can send through the existing lead WhatsApp send
 * layer). Office-gated (viewCompanyReports) + tenant-scoped.
 */
export async function aiWhatsAppReplies(phone: string): Promise<RepliesActionResult> {
  const user = await requireCapability("viewCompanyReports");
  const companyId = user.companyId!;

  const rows = await prisma.activityLog.findMany({
    where: { companyId, action: "whatsapp.inbound" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { meta: true },
  });
  const msgs = rows
    .filter((r) => (r.meta as { from?: string } | null)?.from === phone)
    .slice(0, 8)
    .reverse();
  const thread = msgs
    .map((r) => {
      const text = (r.meta as { text?: string } | null)?.text;
      return typeof text === "string" ? `client: ${text.slice(0, 300)}` : "";
    })
    .filter(Boolean)
    .join("\n");

  const insight = await prisma.whatsAppConversationInsight.findUnique({
    where: { companyId_phone: { companyId, phone } },
    select: { leadId: true },
  });

  const r = await suggestWhatsAppReplies({ companyId, phone, thread });
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, replies: r.replies, leadId: insight?.leadId ?? null, fromCache: r.fromCache };
}
