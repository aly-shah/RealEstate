import type { DealStatus, DealType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/format";

type Dec = Prisma.Decimal | number | null;

// Fallback gross-commission rate (% of deal value) when a pipeline deal hasn't
// had its own grossCommissionPercentage set yet. These are the typical agency
// defaults: ~1% of the sale price, or one month's rent (= 100% of the monthly
// rent we use as the rental's value). A deal's own GCI%, once set, always wins.
const DEFAULT_GCI_PCT: Record<DealType, number> = { SALE: 1, RENTAL: 100 };

/**
 * Commission forecasting.
 *
 * Pipeline (non-closed) deals carry an expected commission = deal value ×
 * gross-commission-% , which we weight by a stage win-probability and bucket by
 * the deal's estimated close date. Owners/admins see the company-wide liability
 * and a 30/60/90-day forecast; agents see their own paid / pending / forecast.
 *
 * All amounts are PKR. Every query is tenant-scoped by companyId.
 */

// Probability a deal at each pipeline stage eventually closes won. Tuned for the
// agency sales funnel; terminal stages (CLOSED_WON / CLOSED_LOST) are excluded
// from the pipeline entirely (won is realised, lost is gone).
export const STAGE_WIN_PROBABILITY: Record<string, number> = {
  DRAFT: 0.1,
  NEGOTIATION: 0.3,
  TOKEN: 0.6,
  BOOKED: 0.8,
  AGREEMENT: 0.9,
};

const OPEN_STATUSES = Object.keys(STAGE_WIN_PROBABILITY) as DealStatus[];

const DAY = 86_400_000;

export interface ForecastBucket {
  key: string;
  label: string;
  deals: number;
  gross: number;
  weighted: number;
}

export interface AgentForecastRow {
  id: string;
  name: string;
  openDeals: number;
  gross: number;
  weighted: number;
}

export interface CompanyForecast {
  buckets: ForecastBucket[];
  weightedTotal: number;
  grossPipeline: number;
  openDeals: number;
  /** Approved-but-unpaid commission shares — money the company already owes out. */
  liability: number;
  byAgent: AgentForecastRow[];
}

type OpenDeal = {
  type: DealType;
  status: DealStatus;
  grossCommissionPercentage: Dec;
  estimatedCloseDate: Date | null;
  closeDate: Date | null;
  sale: { salePrice: Dec } | null;
  rental: { monthlyRent: Dec } | null;
  property: { salePrice: Dec; monthlyRent: Dec } | null;
  agents: { agentId: string }[];
};

// The shape both forecast queries select. Open deals have no Sale/Rental row yet
// (those are created at close), so the expected value comes from the property's
// asking price, by deal type.
const DEAL_SELECT = {
  type: true,
  status: true,
  grossCommissionPercentage: true,
  estimatedCloseDate: true,
  closeDate: true,
  sale: { select: { salePrice: true } },
  rental: { select: { monthlyRent: true } },
  property: { select: { salePrice: true, monthlyRent: true } },
} as const;

/** Expected deal value: the realised sale/rent if present, else the property's asking price. */
function dealValue(d: OpenDeal): number {
  if (d.type === "RENTAL") return toNumber(d.rental?.monthlyRent ?? d.property?.monthlyRent);
  return toNumber(d.sale?.salePrice ?? d.property?.salePrice);
}

/**
 * Pure commission math (exported for unit testing): gross expected commission
 * and its stage-probability-weighted value. `grossPct` of 0 means "unset" and
 * falls back to the agency default for the deal type.
 */
export function expectedCommission(input: {
  type: DealType;
  status: DealStatus;
  grossPct: number;
  value: number;
}): { gross: number; weighted: number } {
  const pct = input.grossPct || DEFAULT_GCI_PCT[input.type];
  const gross = input.value * (pct / 100);
  return { gross, weighted: gross * (STAGE_WIN_PROBABILITY[input.status] ?? 0) };
}

function dealCommission(d: OpenDeal): { gross: number; weighted: number } {
  return expectedCommission({
    type: d.type,
    status: d.status,
    grossPct: toNumber(d.grossCommissionPercentage),
    value: dealValue(d),
  });
}

/** Which 30/60/90 horizon bucket a deal falls into, by estimated close date. */
function bucketFor(d: OpenDeal, now: number): string {
  const when = d.estimatedCloseDate ?? d.closeDate;
  if (!when) return "later";
  const days = (when.getTime() - now) / DAY;
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "later";
}

const BUCKET_DEFS: { key: string; label: string }[] = [
  { key: "d30", label: "Next 30 days" },
  { key: "d60", label: "31–60 days" },
  { key: "d90", label: "61–90 days" },
  { key: "later", label: "90+ days / undated" },
];

/** Company-wide forecast + current payout liability (OWNER/ADMIN view). */
export async function companyCommissionForecast(companyId: string): Promise<CompanyForecast> {
  const now = Date.now();

  const [openDeals, agents, liabilityAgg] = await Promise.all([
    prisma.deal.findMany({
      where: { companyId, status: { in: OPEN_STATUSES } },
      select: { ...DEAL_SELECT, agents: { where: { role: "MAIN" }, select: { agentId: true } } },
    }),
    prisma.user.findMany({ where: { companyId, role: "AGENT" }, select: { id: true, name: true } }),
    // Liability = approved commission shares not yet paid out.
    prisma.commissionShare.aggregate({
      _sum: { amount: true },
      where: { paid: false, commission: { companyId, status: { in: ["APPROVED", "PAID"] } } },
    }),
  ]);

  const buckets = new Map(BUCKET_DEFS.map((b) => [b.key, { ...b, deals: 0, gross: 0, weighted: 0 }]));
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const byAgent = new Map<string, AgentForecastRow>();
  let weightedTotal = 0;
  let grossPipeline = 0;

  for (const d of openDeals as OpenDeal[]) {
    const { gross, weighted } = dealCommission(d);
    grossPipeline += gross;
    weightedTotal += weighted;

    const b = buckets.get(bucketFor(d, now))!;
    b.deals += 1;
    b.gross += gross;
    b.weighted += weighted;

    const agentId = d.agents[0]?.agentId;
    if (agentId) {
      const row = byAgent.get(agentId) ?? {
        id: agentId,
        name: agentName.get(agentId) ?? "Unassigned",
        openDeals: 0,
        gross: 0,
        weighted: 0,
      };
      row.openDeals += 1;
      row.gross += gross;
      row.weighted += weighted;
      byAgent.set(agentId, row);
    }
  }

  return {
    buckets: BUCKET_DEFS.map((b) => buckets.get(b.key)!),
    weightedTotal,
    grossPipeline,
    openDeals: openDeals.length,
    liability: toNumber(liabilityAgg._sum.amount),
    byAgent: [...byAgent.values()].sort((a, b) => b.weighted - a.weighted),
  };
}

export interface AgentForecast {
  paid: number;
  pending: number;
  /** Probability-weighted commission expected from this agent's open pipeline. */
  weightedForecast: number;
  grossPipeline: number;
  openDeals: number;
  /** 1-based rank among the company's agents by total earned (paid + pending). */
  rank: number;
  totalAgents: number;
}

/** A single agent's paid / pending / forecast + their rank in the company. */
export async function agentCommissionForecast(
  companyId: string,
  userId: string,
): Promise<AgentForecast> {
  const [ownShares, openDeals, defaultRule, earnedByAgent] = await Promise.all([
    // This agent's realised commission (paid vs still-pending).
    prisma.commissionShare.groupBy({
      by: ["paid"],
      _sum: { amount: true },
      where: { userId, commission: { companyId } },
    }),
    // Open deals where this agent is the MAIN agent.
    prisma.deal.findMany({
      where: { companyId, status: { in: OPEN_STATUSES }, agents: { some: { agentId: userId, role: "MAIN" } } },
      select: { ...DEAL_SELECT, agents: { where: { role: "MAIN" }, select: { agentId: true } } },
    }),
    prisma.commissionRule.findFirst({ where: { companyId, isDefault: true }, select: { mainAgentPct: true } }),
    // Earned-per-agent for ranking (bounded: one row per recipient).
    prisma.commissionShare.groupBy({
      by: ["userId"],
      _sum: { amount: true },
      where: { commission: { companyId }, userId: { not: null } },
    }),
  ]);

  let paid = 0;
  let pending = 0;
  for (const g of ownShares) {
    if (g.paid) paid = toNumber(g._sum.amount);
    else pending = toNumber(g._sum.amount);
  }

  // The agent's expected slice of the gross is their main-agent split %.
  const mainPct = toNumber(defaultRule?.mainAgentPct ?? 50) / 100;
  let grossPipeline = 0;
  let weightedForecast = 0;
  for (const d of openDeals as OpenDeal[]) {
    const { gross, weighted } = dealCommission(d);
    grossPipeline += gross * mainPct;
    weightedForecast += weighted * mainPct;
  }

  const ranked = earnedByAgent
    .map((g) => ({ userId: g.userId, total: toNumber(g._sum.amount) }))
    .sort((a, b) => b.total - a.total);
  const idx = ranked.findIndex((r) => r.userId === userId);

  return {
    paid,
    pending,
    weightedForecast,
    grossPipeline,
    openDeals: openDeals.length,
    rank: idx === -1 ? ranked.length + 1 : idx + 1,
    totalAgents: ranked.length || 1,
  };
}
