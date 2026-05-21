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

/** Inventory counts grouped by property status. */
export async function inventorySnapshot(companyId: string): Promise<Record<string, number>> {
  const grouped = await prisma.property.groupBy({
    by: ["status"],
    where: { companyId },
    _count: { _all: true },
  });
  return Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
}
