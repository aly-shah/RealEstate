import type { CompanyPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAiConfigured } from "@/lib/ai/provider";

/**
 * Per-plan AI call budget. FREE/TRIAL get zero so the feature is a real
 * upgrade incentive; PRO is uncapped. Numbers match the spirit of
 * lib/plans.ts (Growth ≈ 10× Starter, Pro uncapped).
 *
 * One "call" = one row inserted into AiSuggestion. Cache hits don't burn
 * budget, so a workflow that re-opens the same lead pays once per
 * freshness window (≈30 min) regardless of clicks.
 */
export const AI_BUDGET: Record<CompanyPlan, number> = {
  FREE: 0,
  TRIAL: 25,
  STARTER: 100,
  GROWTH: 1_000,
  PRO: Number.POSITIVE_INFINITY,
};

export interface AiCheck {
  ok: boolean;
  used: number;
  limit: number;
  reason?: string;
}

/**
 * Gate every Claude call site through this. Returns `{ ok: false, reason }`
 * when the tenant is over their monthly budget, has the AI master switch
 * off, or the server has no ANTHROPIC_API_KEY configured. Reason text is
 * UI-safe — surface verbatim in toasts / panel hints.
 *
 * Counts AiSuggestion rows since the first of the current month (server
 * timezone). Postgres COUNT on the indexed (companyId, createdAt) range is
 * O(matched rows) and stays under 1ms for normal volumes — no need for a
 * separate counter column or a periodic reset job.
 */
export async function checkAiBudget(companyId: string): Promise<AiCheck> {
  if (!isAiConfigured()) {
    return {
      ok: false,
      used: 0,
      limit: 0,
      reason: "AI features are not configured on this server.",
    };
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { plan: true, aiEnabled: true },
  });
  if (!company) {
    return { ok: false, used: 0, limit: 0, reason: "Company not found." };
  }
  if (!company.aiEnabled) {
    return {
      ok: false,
      used: 0,
      limit: 0,
      reason: "AI features are disabled for this workspace.",
    };
  }

  const limit = AI_BUDGET[company.plan];
  if (limit === 0) {
    return {
      ok: false,
      used: 0,
      limit: 0,
      reason: "Your current plan doesn't include AI assistance. Upgrade to Starter to enable it.",
    };
  }

  const monthStart = startOfCurrentMonth();
  const used = await prisma.aiSuggestion.count({
    where: { companyId, createdAt: { gte: monthStart } },
  });

  if (Number.isFinite(limit) && used >= limit) {
    return {
      ok: false,
      used,
      limit,
      reason: `Your plan includes ${limit} AI calls per month; you've used ${used}. Resets on the 1st.`,
    };
  }
  return { ok: true, used, limit };
}

/**
 * Snapshot for the Settings → AI usage panel. Mirrors planUsageSnapshot's
 * shape so the UI can render both side-by-side without an extra fetcher.
 */
export async function aiUsageSnapshot(companyId: string) {
  const [company, used] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { plan: true, aiEnabled: true },
    }),
    prisma.aiSuggestion.count({
      where: { companyId, createdAt: { gte: startOfCurrentMonth() } },
    }),
  ]);
  if (!company) return null;
  return {
    aiEnabled: company.aiEnabled,
    serverConfigured: isAiConfigured(),
    used,
    limit: AI_BUDGET[company.plan],
  };
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}
