"use server";

import { requireCapability } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { generateOwnerWeeklyInsight } from "@/lib/ai/handlers/owner-insight";

export interface OwnerInsightResult {
  ok: boolean;
  content?: string;
  fromCache?: boolean;
  reason?: string;
}

/**
 * Owner-only narrative on the reports page. Gated through requireCapability
 * ("viewCompanyReports") which already excludes AGENT/DEALER — anyone
 * landing on this page can run it.
 */
export async function aiOwnerWeeklyInsight(): Promise<OwnerInsightResult> {
  const user = await requireCapability("viewCompanyReports");
  if (!user.companyId) return { ok: false, reason: "No company in session." };

  const result = await generateOwnerWeeklyInsight({ companyId: user.companyId });
  if (!result.ok) return { ok: false, reason: result.reason };

  if (!result.fromCache) {
    await logActivity({
      companyId: user.companyId,
      userId: user.id,
      action: "ai.owner_weekly_insight",
      entityType: "COMPANY",
      entityId: user.companyId,
      summary: "Generated weekly AI insight",
    });
  }
  return { ok: true, content: result.content, fromCache: result.fromCache };
}
