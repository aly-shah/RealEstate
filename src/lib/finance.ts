import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/format";

/**
 * Finance/collections analytics for the finance dashboard and per-deal payment
 * profiles. Everything is tenant-scoped by companyId. "Outstanding" = PENDING /
 * PARTIAL / OVERDUE payment rows; "overdue" = those past their due date (or
 * explicitly OVERDUE).
 */

const DAY = 86_400_000;
const OUTSTANDING = ["PENDING", "PARTIAL", "OVERDUE"] as const;

export interface ForecastBucket { key: string; label: string; amount: number; count: number }
export interface OverdueRow { id: string; dealId: string | null; dealRef: string; buyer: string; label: string; amount: number; dueDate: string | null; daysOverdue: number }
export interface DealProfileRow { dealId: string; dealRef: string; buyer: string; property: string; total: number; paid: number; outstanding: number; pct: number; nextDue: string | null }

export interface FinanceOverview {
  collected: number;
  collectedThisMonth: number;
  outstanding: number;
  overdue: number;
  dueSoon: number;
  counts: { paid: number; outstanding: number; overdue: number };
  buckets: ForecastBucket[];
  monthly: { key: string; label: string; amount: number }[];
  overdueList: OverdueRow[];
  profiles: DealProfileRow[];
}

export async function financeOverview(companyId: string): Promise<FinanceOverview> {
  const now = new Date();
  const nowMs = now.getTime();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [collectedAgg, monthAgg, outstanding, monthlyRows, totalByDeal, paidByDeal] = await Promise.all([
    prisma.payment.aggregate({ _sum: { amount: true }, _count: { _all: true }, where: { companyId, status: "PAID" } }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { companyId, status: "PAID", paidAt: { gte: mStart } } }),
    prisma.payment.findMany({ where: { companyId, status: { in: [...OUTSTANDING] } }, select: { amount: true, dueDate: true, status: true, dealId: true } }),
    prisma.payment.findMany({ where: { companyId, status: "PAID", paidAt: { gte: trendStart } }, select: { amount: true, paidAt: true } }),
    prisma.payment.groupBy({ by: ["dealId"], where: { companyId, dealId: { not: null } }, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ["dealId"], where: { companyId, dealId: { not: null }, status: "PAID" }, _sum: { amount: true } }),
  ]);

  // ── Outstanding → totals, overdue, upcoming buckets, per-deal next due ──
  const buckets: ForecastBucket[] = [
    { key: "d30", label: "Next 30 days", amount: 0, count: 0 },
    { key: "d60", label: "31–60 days", amount: 0, count: 0 },
    { key: "d90", label: "61–90 days", amount: 0, count: 0 },
    { key: "later", label: "90+ days / undated", amount: 0, count: 0 },
  ];
  const bmap = new Map(buckets.map((b) => [b.key, b]));
  let outstandingTotal = 0, overdueTotal = 0, overdueCount = 0;
  const nextDueByDeal = new Map<string, Date>();
  for (const p of outstanding) {
    const amt = toNumber(p.amount);
    outstandingTotal += amt;
    const overdue = p.status === "OVERDUE" || (!!p.dueDate && p.dueDate.getTime() < nowMs);
    if (overdue) { overdueTotal += amt; overdueCount++; }
    else {
      let key = "later";
      if (p.dueDate) { const days = (p.dueDate.getTime() - nowMs) / DAY; key = days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "later"; }
      const b = bmap.get(key)!; b.amount += amt; b.count++;
    }
    if (p.dealId && p.dueDate) {
      const cur = nextDueByDeal.get(p.dealId);
      if (!cur || p.dueDate < cur) nextDueByDeal.set(p.dealId, p.dueDate);
    }
  }

  // ── Monthly collections trend (last 6 months) ──
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short" }), amount: 0 };
  });
  const mIdx = new Map(monthly.map((m) => [m.key, m]));
  for (const r of monthlyRows) {
    if (!r.paidAt) continue;
    const key = `${r.paidAt.getFullYear()}-${String(r.paidAt.getMonth() + 1).padStart(2, "0")}`;
    const m = mIdx.get(key); if (m) m.amount += toNumber(r.amount);
  }

  // ── Per-deal profiles (collection % per deal) ──
  const paidMap = new Map(paidByDeal.map((g) => [g.dealId, toNumber(g._sum.amount)]));
  const dealIds = totalByDeal.map((g) => g.dealId).filter((x): x is string => !!x);
  const deals = dealIds.length
    ? await prisma.deal.findMany({ where: { id: { in: dealIds }, companyId }, select: { id: true, reference: true, client: { select: { name: true } }, property: { select: { title: true } } } })
    : [];
  const dealInfo = new Map(deals.map((d) => [d.id, d]));
  const profiles: DealProfileRow[] = totalByDeal
    .filter((g) => g.dealId)
    .map((g) => {
      const id = g.dealId!;
      const total = toNumber(g._sum.amount);
      const paid = paidMap.get(id) ?? 0;
      const info = dealInfo.get(id);
      const nd = nextDueByDeal.get(id);
      return {
        dealId: id, dealRef: info?.reference ?? "—", buyer: info?.client?.name ?? "—", property: info?.property?.title ?? "—",
        total, paid, outstanding: total - paid, pct: total ? Math.round((paid / total) * 100) : 0,
        nextDue: nd ? nd.toISOString() : null,
      };
    })
    .filter((p) => p.total > 0)
    .sort((a, b) => b.outstanding - a.outstanding);

  // ── Overdue list (with deal/buyer) ──
  const overdueRaw = await prisma.payment.findMany({
    where: { companyId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] }, OR: [{ status: "OVERDUE" }, { dueDate: { lt: now } }] },
    orderBy: { dueDate: "asc" }, take: 25,
    select: { id: true, type: true, notes: true, amount: true, dueDate: true, dealId: true, deal: { select: { reference: true, client: { select: { name: true } } } } },
  });
  const overdueList: OverdueRow[] = overdueRaw.map((p) => ({
    id: p.id, dealId: p.dealId, dealRef: p.deal?.reference ?? "—", buyer: p.deal?.client?.name ?? "—",
    label: p.notes || p.type, amount: toNumber(p.amount), dueDate: p.dueDate ? p.dueDate.toISOString() : null,
    daysOverdue: p.dueDate ? Math.max(0, Math.floor((nowMs - p.dueDate.getTime()) / DAY)) : 0,
  }));

  return {
    collected: toNumber(collectedAgg._sum.amount),
    collectedThisMonth: toNumber(monthAgg._sum.amount),
    outstanding: outstandingTotal,
    overdue: overdueTotal,
    dueSoon: bmap.get("d30")!.amount,
    counts: { paid: collectedAgg._count._all, outstanding: outstanding.length, overdue: overdueCount },
    buckets, monthly, overdueList, profiles,
  };
}

export interface DealPaymentProfile {
  deal: { id: string; reference: string; type: string; status: string };
  buyer: { id: string; name: string; portalToken: string | null; portalEnabled: boolean } | null;
  property: { title: string; reference: string; project: string | null } | null;
  dealer: string | null;
  total: number; paid: number; outstanding: number; overdue: number; pct: number;
  nextDue: { label: string; amount: number; dueDate: string | null } | null;
  schedule: { id: string; label: string; amount: number; status: string; dueDate: string | null; paidAt: string | null; method: string | null; receiptNo: string | null }[];
}

export async function dealPaymentProfile(companyId: string, dealId: string): Promise<DealPaymentProfile | null> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, companyId },
    select: {
      id: true, reference: true, type: true, status: true,
      client: { select: { id: true, name: true, portalToken: true, portalEnabled: true } },
      property: { select: { title: true, reference: true, project: { select: { name: true } } } },
      dealer: { select: { name: true } },
    },
  });
  if (!deal) return null;

  const payments = await prisma.payment.findMany({
    where: { companyId, dealId },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, type: true, notes: true, amount: true, status: true, dueDate: true, paidAt: true, method: true, receiptNo: true },
  });

  const now = Date.now();
  let total = 0, paid = 0, overdue = 0;
  let next: (typeof payments)[number] | null = null;
  for (const p of payments) {
    const a = toNumber(p.amount);
    total += a;
    if (p.status === "PAID") paid += a;
    else {
      if (!next) next = p;
      if (p.status === "OVERDUE" || (p.dueDate && p.dueDate.getTime() < now)) overdue += a;
    }
  }

  return {
    deal: { id: deal.id, reference: deal.reference, type: deal.type, status: deal.status },
    buyer: deal.client,
    property: deal.property ? { title: deal.property.title, reference: deal.property.reference, project: deal.property.project?.name ?? null } : null,
    dealer: deal.dealer?.name ?? null,
    total, paid, outstanding: total - paid, overdue, pct: total ? Math.round((paid / total) * 100) : 0,
    nextDue: next ? { label: next.notes || next.type, amount: toNumber(next.amount), dueDate: next.dueDate ? next.dueDate.toISOString() : null } : null,
    schedule: payments.map((p) => ({
      id: p.id, label: p.notes || p.type, amount: toNumber(p.amount), status: p.status,
      dueDate: p.dueDate ? p.dueDate.toISOString() : null, paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      method: p.method, receiptNo: p.receiptNo,
    })),
  };
}
