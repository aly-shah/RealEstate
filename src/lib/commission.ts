import type { CommissionParty } from "@prisma/client";

export interface CommissionRuleInput {
  mainAgentPct: number;
  companyPct: number;
  otherAgentPct: number;
  dealerPct: number;
  noOtherFallback: "MAIN" | "COMPANY";
}

export interface CommissionContext {
  total: number;
  mainAgent: { id: string; name: string } | null;
  otherAgents: { id: string; name: string }[];
  dealer: { id: string; name: string } | null;
}

export interface ComputedShare {
  party: CommissionParty;
  userId?: string;
  dealerId?: string;
  label: string;
  pct: number;
  amount: number;
}

/**
 * Splits a deal's total commission according to the rule (requirements §12).
 *
 * Rules of thumb:
 *  - Percentages are of the *total* commission.
 *  - If there are no "other" agents, their slice follows `noOtherFallback`.
 *  - If there is no dealer, the dealer slice rolls into the company.
 *  - The "other agents" slice is split equally among them.
 *
 * The result always sums back to `total` (rounding handled on the main share).
 */
export function computeCommission(
  rule: CommissionRuleInput,
  ctx: CommissionContext,
): ComputedShare[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  const hasOthers = ctx.otherAgents.length > 0;
  const hasDealer = !!ctx.dealer;

  let mainPct = rule.mainAgentPct;
  let companyPct = rule.companyPct;
  const otherPctTotal = rule.otherAgentPct;
  let dealerPct = hasDealer ? rule.dealerPct : 0;

  // Re-home the "other agents" slice when there are none.
  if (!hasOthers) {
    if (rule.noOtherFallback === "COMPANY") companyPct += otherPctTotal;
    else mainPct += otherPctTotal;
  }
  // No dealer → their slice goes to the company.
  if (!hasDealer && rule.dealerPct > 0) companyPct += rule.dealerPct;

  const shares: ComputedShare[] = [];

  if (ctx.mainAgent) {
    shares.push({
      party: "AGENT_MAIN",
      userId: ctx.mainAgent.id,
      label: `${ctx.mainAgent.name} (main)`,
      pct: round(mainPct),
      amount: round((ctx.total * mainPct) / 100),
    });
  }

  shares.push({
    party: "COMPANY",
    label: "Company",
    pct: round(companyPct),
    amount: round((ctx.total * companyPct) / 100),
  });

  if (hasOthers) {
    const each = otherPctTotal / ctx.otherAgents.length;
    for (const a of ctx.otherAgents) {
      shares.push({
        party: "AGENT_OTHER",
        userId: a.id,
        label: `${a.name} (co-agent)`,
        pct: round(each),
        amount: round((ctx.total * each) / 100),
      });
    }
  }

  if (hasDealer && dealerPct > 0) {
    shares.push({
      party: "DEALER",
      dealerId: ctx.dealer!.id,
      label: ctx.dealer!.name,
      pct: round(dealerPct),
      amount: round((ctx.total * dealerPct) / 100),
    });
  }

  // Absorb any rounding drift into the first share so totals reconcile.
  const sum = shares.reduce((s, x) => s + x.amount, 0);
  const drift = round(ctx.total - sum);
  if (drift !== 0 && shares.length > 0) shares[0].amount = round(shares[0].amount + drift);

  return shares;
}
