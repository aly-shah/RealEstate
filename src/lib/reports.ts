import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/format";
import type { LeadStage, LeadSource } from "@prisma/client";

/* ─────────────────────────────────────────────────────────── Date-range parsing */

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Parse `?from=...&to=...` from the reports searchParams. Falls back to
 * start-of-current-month → now. Always clamps `to` to the end of its day so a
 * filter like `to=2026-05-24` includes everything happening on the 24th.
 */
export function parseDateRange(sp: { from?: string; to?: string }): DateRange {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);

  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? new Date(`${sp.from}T00:00:00`) : defaultFrom;
  const toRaw = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? new Date(`${sp.to}T23:59:59.999`) : now;
  // Defensive: if `to` ends up before `from`, swap so queries still run.
  return from <= toRaw ? { from, to: toRaw } : { from: toRaw, to: from };
}

export function fmtIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ─────────────────────────────────────────────────────────── Sales vs rentals */

export interface MonthlyRevenuePoint {
  month: string;
  key: string;
  sales: number;
  rentals: number;
}

export interface MonthlyRevenueResult {
  points: MonthlyRevenuePoint[];
  /** True when the rendered window was trimmed to MAX_MONTHLY_BUCKETS. */
  clamped: boolean;
}

/** Past this, the area chart turns into visual mush — anchor the right edge. */
const MAX_MONTHLY_BUCKETS = 24;

/**
 * Split monthly revenue into sale + rental for the given window. Caps the
 * number of months rendered (anchored at the end of the range) so a user
 * picking a 5-year window doesn't render 60 needle-thin bars.
 */
export async function monthlySalesVsRentals(
  companyId: string,
  range: DateRange,
): Promise<MonthlyRevenueResult> {
  // Build the full set of month-keys the user asked for, then clamp from the
  // end so we keep the most-recent window when truncating.
  const allKeys: { key: string; month: string }[] = [];
  const cursor = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
  while (cursor <= range.to) {
    allKeys.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      month: cursor.toLocaleString("en-US", { month: "short" }),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const clamped = allKeys.length > MAX_MONTHLY_BUCKETS;
  const keys = clamped ? allKeys.slice(-MAX_MONTHLY_BUCKETS) : allKeys;

  // Narrow the DB read to the actually-rendered window to save bandwidth on
  // long ranges. `effectiveFrom` is the first day of the first rendered month.
  const effectiveFrom = new Date(`${keys[0]?.key ?? `${range.from.getFullYear()}-01`}-01T00:00:00`);

  const deals = await prisma.deal.findMany({
    where: {
      companyId,
      status: "CLOSED_WON",
      closeDate: { gte: effectiveFrom, lte: range.to },
    },
    select: {
      type: true,
      closeDate: true,
      sale: { select: { salePrice: true } },
      rental: { select: { monthlyRent: true } },
    },
  });

  const buckets = new Map<string, MonthlyRevenuePoint>(
    keys.map((k) => [k.key, { ...k, sales: 0, rentals: 0 }]),
  );

  for (const d of deals) {
    if (!d.closeDate) continue;
    const key = `${d.closeDate.getFullYear()}-${String(d.closeDate.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(key);
    if (!b) continue;
    if (d.type === "SALE") b.sales += toNumber(d.sale?.salePrice);
    else b.rentals += toNumber(d.rental?.monthlyRent);
  }
  return { points: [...buckets.values()], clamped };
}

/* ─────────────────────────────────────────────────────────── Source conversion */

export interface SourceConversionRow {
  source: LeadSource;
  total: number;
  won: number;
  lost: number;
  conversion: number; // %
}

/**
 * Source-by-source pipeline conversion within the window. The `total` count
 * uses lead `createdAt`; `won` / `lost` use the lead's current stage at
 * query time (the lead model doesn't track close date separately). For most
 * reporting windows this is the same answer; for "last month" specifically
 * a lead created in the window but closed-won this month still counts.
 */
export async function leadSourceConversion(
  companyId: string,
  range: DateRange,
): Promise<SourceConversionRow[]> {
  const grouped = await prisma.lead.groupBy({
    by: ["source", "stage"],
    where: {
      companyId,
      createdAt: { gte: range.from, lte: range.to },
    },
    _count: { _all: true },
  });

  const rowMap = new Map<LeadSource, SourceConversionRow>();
  for (const g of grouped) {
    const r = rowMap.get(g.source) ?? {
      source: g.source,
      total: 0,
      won: 0,
      lost: 0,
      conversion: 0,
    };
    r.total += g._count._all;
    if (g.stage === "CLOSED_WON") r.won += g._count._all;
    if (g.stage === "CLOSED_LOST") r.lost += g._count._all;
    rowMap.set(g.source, r);
  }

  // Sort by absolute volume so high-traffic sources land at top.
  return [...rowMap.values()]
    .map((r) => ({ ...r, conversion: r.total ? Math.round((r.won / r.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

/* ─────────────────────────────────────────────────────────── Funnel drop-off */

export interface FunnelStep {
  stage: LeadStage;
  count: number;
  /** Retention vs the previous stage (NEW is always 100). */
  retentionPct: number;
}

const FUNNEL_ORDER: LeadStage[] = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "SITE_VISIT",
  "PROPERTY_SHOWN",
  "NEGOTIATION",
  "TOKEN_BOOKING",
  "PAYMENT",
  "CLOSED_WON",
];

/**
 * Pipeline funnel with stage-to-stage retention %. Aggregates leads that have
 * EVER reached each stage by treating the current stage's index in
 * `FUNNEL_ORDER` as the high-water mark — so a lead in NEGOTIATION counts
 * towards every earlier stage too. CLOSED_LOST is excluded; "lost between
 * stages" lives in the lost-reason analytics instead.
 */
export async function funnelDropoff(
  companyId: string,
  range: DateRange,
): Promise<FunnelStep[]> {
  const grouped = await prisma.lead.groupBy({
    by: ["stage"],
    where: {
      companyId,
      stage: { not: "CLOSED_LOST" },
      createdAt: { gte: range.from, lte: range.to },
    },
    _count: { _all: true },
  });
  const byStage = new Map<LeadStage, number>(grouped.map((g) => [g.stage, g._count._all]));

  // Cumulative: a lead at PAYMENT also passed through SITE_VISIT etc.
  const stepCounts = FUNNEL_ORDER.map((stage, i) => {
    let count = 0;
    for (let j = i; j < FUNNEL_ORDER.length; j++) {
      count += byStage.get(FUNNEL_ORDER[j]) ?? 0;
    }
    return { stage, count };
  });

  return stepCounts.map((s, i) => {
    const prev = i === 0 ? s.count : stepCounts[i - 1].count;
    return {
      ...s,
      retentionPct: prev > 0 ? Math.round((s.count / prev) * 100) : 0,
    };
  });
}

/* ─────────────────────────────────────────────────────────── Overdue aging */

export interface AgingBucket {
  label: string;
  count: number;
  amount: number;
}

/**
 * Bucket overdue payments by how late they are. Bucket boundaries match
 * standard accounting practice (current / 30 / 60 / 90+) so the numbers
 * line up with whatever finance software the company is also using.
 */
export async function paymentOverdueAging(companyId: string): Promise<AgingBucket[]> {
  const now = new Date();
  const overdue = await prisma.payment.findMany({
    where: {
      companyId,
      status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
      dueDate: { lt: now },
    },
    select: { amount: true, dueDate: true },
  });

  const buckets: AgingBucket[] = [
    { label: "1–30 days", count: 0, amount: 0 },
    { label: "31–60 days", count: 0, amount: 0 },
    { label: "61–90 days", count: 0, amount: 0 },
    { label: "90+ days", count: 0, amount: 0 },
  ];

  for (const p of overdue) {
    if (!p.dueDate) continue;
    const days = Math.floor((now.getTime() - p.dueDate.getTime()) / 86_400_000);
    const i = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
    buckets[i].count += 1;
    buckets[i].amount += toNumber(p.amount);
  }
  return buckets;
}

/* ─────────────────────────────────────────────────────────── Inventory aging */

export interface InventoryAgingBucket {
  label: string;
  count: number;
}

/**
 * Days-on-market histogram for currently-listed (non-closed) properties.
 * Buckets at 30 / 60 / 90 / 180 / 180+ days. Mirrors what real-estate listing
 * portals show as "stale inventory" — owners use it to spot listings that
 * need a price drop or fresh photos.
 */
export async function propertyInventoryAging(companyId: string): Promise<InventoryAgingBucket[]> {
  const props = await prisma.property.findMany({
    where: {
      companyId,
      status: { in: ["AVAILABLE", "UNDER_NEGOTIATION", "RESERVED", "PENDING_VERIFICATION"] },
    },
    select: { createdAt: true },
  });

  const now = Date.now();
  const buckets: InventoryAgingBucket[] = [
    { label: "≤ 30 days", count: 0 },
    { label: "31–60 days", count: 0 },
    { label: "61–90 days", count: 0 },
    { label: "91–180 days", count: 0 },
    { label: "180+ days", count: 0 },
  ];

  for (const p of props) {
    const days = Math.floor((now - p.createdAt.getTime()) / 86_400_000);
    const i = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : days <= 180 ? 3 : 4;
    buckets[i].count += 1;
  }
  return buckets;
}

/* ─────────────────────────────────────────────────────────── Visit verification */

export interface VisitVerificationStats {
  total: number;
  verified: number;
  pending: number;
  flagged: number;
  rejected: number;
  verificationRate: number; // %
}

/**
 * Visit verification health over the window. The verification rate is the
 * main signal — an agency where most visits don't get verified within a
 * reasonable time has a process problem worth surfacing.
 */
export async function visitVerificationStats(
  companyId: string,
  range: DateRange,
): Promise<VisitVerificationStats> {
  const grouped = await prisma.showing.groupBy({
    by: ["verification"],
    where: { companyId, createdAt: { gte: range.from, lte: range.to } },
    _count: { _all: true },
  });
  let verified = 0;
  let pending = 0;
  let flagged = 0;
  let rejected = 0;
  for (const g of grouped) {
    const n = g._count._all;
    if (g.verification === "VERIFIED") verified += n;
    else if (g.verification === "PENDING") pending += n;
    else if (g.verification === "FLAGGED") flagged += n;
    else if (g.verification === "REJECTED") rejected += n;
  }
  const total = verified + pending + flagged + rejected;
  return {
    total,
    verified,
    pending,
    flagged,
    rejected,
    verificationRate: total ? Math.round((verified / total) * 100) : 0,
  };
}
