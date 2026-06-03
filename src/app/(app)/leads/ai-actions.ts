"use server";

import { requireCompanyUser } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { suggestLeadNextAction } from "@/lib/ai/handlers/lead-next-action";
import { draftLeadReply } from "@/lib/ai/handlers/lead-reply-draft";

export interface AiActionResult {
  ok: boolean;
  content?: string;
  fromCache?: boolean;
  reason?: string;
}

/**
 * Server action wired to the AI panel on the lead detail page. Returns the
 * suggestion text plus a cache-hit flag so the UI can label "served from
 * cache" without re-fetching.
 *
 * Tenant scoping happens twice: requireCompanyUser narrows to the caller's
 * companyId, and the handler re-filters with `where: { companyId }` so a
 * stale leadId from a previous session can't leak across tenants.
 */
export async function aiSuggestLeadNextAction(leadId: string): Promise<AiActionResult> {
  const user = await requireCompanyUser();
  const result = await suggestLeadNextAction({
    companyId: user.companyId,
    leadId,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  // Log only on fresh calls — cache hits aren't a billable/visible action.
  if (!result.fromCache) {
    await logActivity({
      companyId: user.companyId,
      userId: user.id,
      action: "ai.lead_next_action",
      entityType: "LEAD",
      entityId: leadId,
      summary: "AI suggested next action",
    });
  }
  return { ok: true, content: result.content, fromCache: result.fromCache };
}

/**
 * Draft a WhatsApp reply for the lead. The optional `steer` parameter lets
 * the agent shape the draft without seeing the prompt internals
 * ("emphasise the budget concern", "they cancelled yesterday").
 */
export async function aiDraftLeadReply(
  leadId: string,
  steer?: string,
): Promise<AiActionResult> {
  const user = await requireCompanyUser();
  const result = await draftLeadReply({
    companyId: user.companyId,
    leadId,
    steer: steer?.trim() || undefined,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  if (!result.fromCache) {
    await logActivity({
      companyId: user.companyId,
      userId: user.id,
      action: "ai.lead_reply_draft",
      entityType: "LEAD",
      entityId: leadId,
      summary: steer ? `AI drafted reply (steered: ${steer.slice(0, 60)})` : "AI drafted reply",
    });
  }
  return { ok: true, content: result.content, fromCache: result.fromCache };
}
