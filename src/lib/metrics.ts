import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/format";

export function monthStart(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Total sale value of won SALE deals closed since `since`. */
export async function salesRevenue(companyId: string, since?: Date): Promise<number> {
  const sales = await prisma.sale.findMany({
    where: {
      deal: {
        companyId,
        status: "CLOSED_WON",
        ...(since ? { closeDate: { gte: since } } : {}),
      },
    },
    select: { salePrice: true },
  });
  return sales.reduce((sum, s) => sum + toNumber(s.salePrice), 0);
}

/** Commission totals split into paid vs pending across all shares. */
export async function commissionTotals(companyId: string) {
  const shares = await prisma.commissionShare.findMany({
    where: { commission: { companyId } },
    select: { amount: true, paid: true },
  });
  let paid = 0;
  let pending = 0;
  for (const s of shares) {
    const amt = toNumber(s.amount);
    if (s.paid) paid += amt;
    else pending += amt;
  }
  return { paid, pending, total: paid + pending };
}

/** Money still owed to the company: pending/partial/overdue payments. */
export async function outstandingPayments(companyId: string) {
  const rows = await prisma.payment.findMany({
    where: { companyId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
    select: { amount: true, status: true, dueDate: true },
  });
  const now = new Date();
  let due = 0;
  let overdue = 0;
  for (const r of rows) {
    const amt = toNumber(r.amount);
    if (r.status === "OVERDUE" || (r.dueDate && r.dueDate < now)) overdue += amt;
    else due += amt;
  }
  return { due, overdue, total: due + overdue, count: rows.length };
}

export interface AgentRanking {
  id: string;
  name: string;
  dealsWon: number;
  revenue: number;
  leads: number;
  conversion: number;
}

/** Leaderboard: agents ranked by closed-deal revenue. */
export async function agentLeaderboard(companyId: string): Promise<AgentRanking[]> {
  const agents = await prisma.user.findMany({
    where: { companyId, role: "AGENT" },
    select: {
      id: true,
      name: true,
      assignedLeads: { select: { stage: true } },
      dealLinks: {
        where: { role: "MAIN" },
        select: {
          deal: {
            select: { status: true, sale: { select: { salePrice: true } }, rental: { select: { monthlyRent: true } } },
          },
        },
      },
    },
  });

  const ranked = agents.map((a) => {
    const won = a.dealLinks.filter((d) => d.deal.status === "CLOSED_WON");
    const revenue = won.reduce(
      (sum, d) => sum + toNumber(d.deal.sale?.salePrice) + toNumber(d.deal.rental?.monthlyRent),
      0,
    );
    const leads = a.assignedLeads.length;
    const wonLeads = a.assignedLeads.filter((l) => l.stage === "CLOSED_WON").length;
    return {
      id: a.id,
      name: a.name,
      dealsWon: won.length,
      revenue,
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
  const shares = await prisma.commissionShare.findMany({
    where: { commission: { companyId, status: { in: ["APPROVED", "PAID"] } } },
    select: {
      party: true,
      amount: true,
      paid: true,
      userId: true,
      dealerId: true,
      user: { select: { id: true, name: true } },
      dealer: { select: { id: true, name: true } },
    },
  });

  const recipMap = new Map<string, PayoutByRecipient>();
  const partyMap: Record<string, { paid: number; pending: number }> = {};
  let totalPaid = 0;
  let totalPending = 0;

  for (const s of shares) {
    const amt = toNumber(s.amount);
    if (s.paid) totalPaid += amt;
    else totalPending += amt;

    if (!partyMap[s.party]) partyMap[s.party] = { paid: 0, pending: 0 };
    partyMap[s.party][s.paid ? "paid" : "pending"] += amt;

    // Identity key per recipient — collapses multiple shares to one row.
    let key: string;
    let name: string;
    if (s.party === "COMPANY") {
      key = "company";
      name = "Company";
    } else if (s.party === "DEALER") {
      key = `dealer:${s.dealerId ?? "unknown"}`;
      name = s.dealer?.name ?? "Unknown dealer";
    } else {
      key = `user:${s.userId ?? "unknown"}`;
      name = s.user?.name ?? "Unknown agent";
    }

    const existing = recipMap.get(key) ?? { id: key, name, party: s.party, paid: 0, pending: 0 };
    existing[s.paid ? "paid" : "pending"] += amt;
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
