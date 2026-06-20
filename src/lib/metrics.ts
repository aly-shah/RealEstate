import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invalidateTags } from "@/lib/query-optimizer";
import { toNumber } from "@/lib/format";

export function monthStart(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Cache tag for a tenant's dashboard metric bundle (see OwnerDashboard's
 * cachedQuery). Centralized so the producer and the invalidators can't drift.
 */
export const companyMetricsTag = (companyId: string) => `co:${companyId}:metrics`;

/**
 * Bust the cached dashboard metrics for a tenant. Call from any mutation that
 * moves money/revenue (deal close, payment, commission) so the owner dashboard
 * reflects it on the next render instead of waiting out the 60s TTL.
 */
export function invalidateCompanyMetrics(companyId: string): void {
  invalidateTags(companyMetricsTag(companyId));
}

/** Total sale value of won SALE deals closed since `since`. */
export async function salesRevenue(companyId: string, since?: Date): Promise<number> {
  // Sum in SQL rather than pulling every Sale row into JS — on a large tenant
  // this transfers one scalar instead of thousands of rows.
  const agg = await prisma.sale.aggregate({
    _sum: { salePrice: true },
    where: {
      deal: {
        companyId,
        status: "CLOSED_WON",
        ...(since ? { closeDate: { gte: since } } : {}),
      },
    },
  });
  return toNumber(agg._sum.salePrice);
}

/** Commission totals split into paid vs pending across all shares. */
export async function commissionTotals(companyId: string) {
  // groupBy(paid) returns at most two rows (true/false) with the summed amount,
  // instead of every CommissionShare row.
  const grouped = await prisma.commissionShare.groupBy({
    by: ["paid"],
    _sum: { amount: true },
    where: { commission: { companyId } },
  });
  let paid = 0;
  let pending = 0;
  for (const g of grouped) {
    const amt = toNumber(g._sum.amount);
    if (g.paid) paid = amt;
    else pending = amt;
  }
  return { paid, pending, total: paid + pending };
}

/** Money still owed to the company: pending/partial/overdue payments. */
export async function outstandingPayments(companyId: string) {
  // "Overdue" = status OVERDUE, or a PENDING/PARTIAL row whose dueDate has passed.
  // "Due"     = PENDING/PARTIAL with no due date or one still in the future.
  // Three SQL aggregates replace fetching the full payment table into JS.
  const now = new Date();
  const overdueWhere: Prisma.PaymentWhereInput = {
    companyId,
    OR: [
      { status: "OVERDUE" },
      { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: now } },
    ],
  };
  const dueWhere: Prisma.PaymentWhereInput = {
    companyId,
    status: { in: ["PENDING", "PARTIAL"] },
    OR: [{ dueDate: null }, { dueDate: { gte: now } }],
  };

  const [overdueAgg, dueAgg, total] = await Promise.all([
    prisma.payment.aggregate({ _sum: { amount: true }, where: overdueWhere }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: dueWhere }),
    prisma.payment.count({ where: { companyId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } } }),
  ]);

  const overdue = toNumber(overdueAgg._sum.amount);
  const due = toNumber(dueAgg._sum.amount);
  return { due, overdue, total: due + overdue, count: total };
}

export interface AgentRanking {
  id: string;
  name: string;
  dealsWon: number;
  revenue: number;
  leads: number;
  conversion: number;
}

/** Leaderboard: agents ranked by closed-deal revenue.
 *  Lead totals come from two DB groupBys (not per-agent row fetches); revenue
 *  from the bounded set of CLOSED_WON deals (far fewer than all leads/deals). */
export async function agentLeaderboard(companyId: string): Promise<AgentRanking[]> {
  const [agents, leadCounts, wonLeadCounts, wonDeals] = await Promise.all([
    prisma.user.findMany({ where: { companyId, role: "AGENT" }, select: { id: true, name: true } }),
    prisma.lead.groupBy({
      by: ["agentId"],
      where: { companyId, agentId: { not: null } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["agentId"],
      where: { companyId, agentId: { not: null }, stage: "CLOSED_WON" },
      _count: { _all: true },
    }),
    prisma.deal.findMany({
      where: { companyId, status: "CLOSED_WON" },
      select: {
        sale: { select: { salePrice: true } },
        rental: { select: { monthlyRent: true } },
        agents: { where: { role: "MAIN" }, select: { agentId: true } },
      },
    }),
  ]);

  const leadMap = new Map(leadCounts.map((g) => [g.agentId, g._count._all]));
  const wonLeadMap = new Map(wonLeadCounts.map((g) => [g.agentId, g._count._all]));
  const dealAgg = new Map<string, { revenue: number; dealsWon: number }>();
  for (const d of wonDeals) {
    const agentId = d.agents[0]?.agentId;
    if (!agentId) continue;
    const value = toNumber(d.sale?.salePrice) + toNumber(d.rental?.monthlyRent);
    const cur = dealAgg.get(agentId) ?? { revenue: 0, dealsWon: 0 };
    cur.revenue += value;
    cur.dealsWon += 1;
    dealAgg.set(agentId, cur);
  }

  const ranked = agents.map((a) => {
    const leads = leadMap.get(a.id) ?? 0;
    const wonLeads = wonLeadMap.get(a.id) ?? 0;
    const da = dealAgg.get(a.id) ?? { revenue: 0, dealsWon: 0 };
    return {
      id: a.id,
      name: a.name,
      dealsWon: da.dealsWon,
      revenue: da.revenue,
      leads,
      conversion: leads ? Math.round((wonLeads / leads) * 100) : 0,
    };
  });

  return ranked.sort((a, b) => b.revenue - a.revenue || b.dealsWon - a.dealsWon);
}

export interface RevenuePoint {
  month: string;
  key: string;
  revenue: number;
}

/** Sales revenue bucketed by month for the last `months` months (inclusive of this one). */
export async function monthlyRevenue(companyId: string, months = 6): Promise<RevenuePoint[]> {
  const now = new Date();
  const buckets: RevenuePoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.push({
      month: d.toLocaleString("en-US", { month: "short" }),
      key,
      revenue: 0,
    });
  }
  const since = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  const sales = await prisma.sale.findMany({
    where: {
      deal: {
        companyId,
        status: "CLOSED_WON",
        closeDate: { gte: since },
      },
    },
    select: { salePrice: true, deal: { select: { closeDate: true } } },
  });

  for (const s of sales) {
    const d = s.deal.closeDate;
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.find((b) => b.key === key);
    if (bucket) bucket.revenue += toNumber(s.salePrice);
  }
  return buckets;
}

/** Lead pipeline counts grouped by stage, in canonical workflow order. */
export async function leadsByStage(companyId: string): Promise<{ stage: string; count: number }[]> {
  const order = [
    "NEW",
    "CONTACTED",
    "INTERESTED",
    "SITE_VISIT",
    "PROPERTY_SHOWN",
    "NEGOTIATION",
    "TOKEN_BOOKING",
    "PAYMENT",
    "CLOSED_WON",
  ] as const;
  const grouped = await prisma.lead.groupBy({
    by: ["stage"],
    where: { companyId, stage: { not: "CLOSED_LOST" } },
    _count: { _all: true },
  });
  const map = new Map(grouped.map((g) => [g.stage, g._count._all]));
  return order.map((stage) => ({ stage, count: map.get(stage) ?? 0 }));
}

/** Inventory counts grouped by property status. */
export async function inventorySnapshot(companyId: string): Promise<Record<string, number>> {
  const grouped = await prisma.property.groupBy({
    by: ["status"],
    where: { companyId },
    _count: { _all: true },
  });
  return Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
}

export interface PayoutByRecipient {
  id: string;
  name: string;
  party: "AGENT_MAIN" | "AGENT_OTHER" | "DEALER" | "COMPANY";
  paid: number;
  pending: number;
}

export interface PayoutSummary {
  byRecipient: PayoutByRecipient[];
  byParty: Record<string, { paid: number; pending: number }>;
  totals: { paid: number; pending: number };
}

/**
 * Aggregates commission shares into per-recipient + per-party totals. Powers
 * the "Commission payouts" panel on the reports page — owners need a single
 * view of who has been paid vs who is still owed money.
 *
 * Recipient resolution:
 *   - AGENT_MAIN / AGENT_OTHER → user name (or "Unknown agent" if SetNull-ed)
 *   - DEALER                   → dealer name (or "Unknown dealer")
 *   - COMPANY                  → aggregated under a single "Company" line
 */
export async function payoutSummary(companyId: string): Promise<PayoutSummary> {
  // DB aggregation: summed amounts per (party, paid, recipient) instead of every
  // CommissionShare row. Names resolved with one bounded lookup each.
  const grouped = await prisma.commissionShare.groupBy({
    by: ["party", "paid", "userId", "dealerId"],
    where: { commission: { companyId, status: { in: ["APPROVED", "PAID"] } } },
    _sum: { amount: true },
  });

  const userIds = [...new Set(grouped.map((g) => g.userId).filter((x): x is string => !!x))];
  const dealerIds = [...new Set(grouped.map((g) => g.dealerId).filter((x): x is string => !!x))];
  const [users, dealers] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    dealerIds.length ? prisma.dealer.findMany({ where: { id: { in: dealerIds } }, select: { id: true, name: true } }) : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const dealerName = new Map(dealers.map((d) => [d.id, d.name]));

  const recipMap = new Map<string, PayoutByRecipient>();
  const partyMap: Record<string, { paid: number; pending: number }> = {};
  let totalPaid = 0;
  let totalPending = 0;

  for (const g of grouped) {
    const amt = toNumber(g._sum.amount);
    if (g.paid) totalPaid += amt;
    else totalPending += amt;

    if (!partyMap[g.party]) partyMap[g.party] = { paid: 0, pending: 0 };
    partyMap[g.party][g.paid ? "paid" : "pending"] += amt;

    let key: string;
    let name: string;
    if (g.party === "COMPANY") {
      key = "company";
      name = "Company";
    } else if (g.party === "DEALER") {
      key = `dealer:${g.dealerId ?? "unknown"}`;
      name = dealerName.get(g.dealerId ?? "") ?? "Unknown dealer";
    } else {
      key = `user:${g.userId ?? "unknown"}`;
      name = userName.get(g.userId ?? "") ?? "Unknown agent";
    }

    const existing = recipMap.get(key) ?? { id: key, name, party: g.party, paid: 0, pending: 0 };
    existing[g.paid ? "paid" : "pending"] += amt;
    recipMap.set(key, existing);
  }

  const byRecipient = [...recipMap.values()].sort(
    (a, b) => b.paid + b.pending - (a.paid + a.pending),
  );

  return {
    byRecipient,
    byParty: partyMap,
    totals: { paid: totalPaid, pending: totalPending },
  };
}
