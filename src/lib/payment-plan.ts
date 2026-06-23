import type { PaymentType } from "@prisma/client";

/**
 * Payment-plan expansion: turn an installment template + a sale price into a
 * concrete schedule of dated payments. Pure (no I/O, no clock) so it's unit
 * tested — the caller passes the start date (the booking's approval date).
 */

export interface ScheduleMilestone {
  label: string;
  /** Total % of the price this milestone covers, split evenly across `count`. */
  pct: number;
  type: PaymentType;
  /** Number of payments this milestone expands into (e.g. 36 monthly). */
  count: number;
  /** Months from start to the first payment, and spacing between them. */
  firstDueMonths: number;
  intervalMonths: number;
}

export interface ScheduledPayment {
  type: PaymentType;
  label: string;
  amount: number;
  dueDate: Date;
}

/** Calendar-month add that doesn't mutate the input. */
export function addMonths(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setMonth(x.getMonth() + n);
  return x;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Expand the milestones into individual payments. Each milestone's slice
 * (price × pct%) is divided across its `count` payments; any rounding remainder
 * lands on that milestone's final payment so the milestone sums exactly.
 */
export function expandSchedule(price: number, startDate: Date, milestones: ScheduleMilestone[]): ScheduledPayment[] {
  const out: ScheduledPayment[] = [];
  for (const m of milestones) {
    const count = Math.max(1, Math.floor(m.count));
    const milestoneTotal = round2((price * m.pct) / 100);
    const per = round2(milestoneTotal / count);
    for (let i = 0; i < count; i++) {
      const amount = i === count - 1 ? round2(milestoneTotal - per * (count - 1)) : per;
      out.push({
        type: m.type,
        label: count > 1 ? `${m.label} ${i + 1}/${count}` : m.label,
        amount,
        dueDate: addMonths(startDate, m.firstDueMonths + i * m.intervalMonths),
      });
    }
  }
  return out;
}

/** Sum of milestone percentages — used to warn when a plan doesn't total 100%. */
export function totalPct(milestones: { pct: number }[]): number {
  return round2(milestones.reduce((s, m) => s + m.pct, 0));
}
