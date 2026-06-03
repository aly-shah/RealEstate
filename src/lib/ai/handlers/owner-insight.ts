import { prisma } from "@/lib/prisma";
import { runAi, type AiCallResult, type AiCallFailure } from "@/lib/ai/run";

/**
 * Owner-facing weekly narrative — "what changed this week vs last".
 *
 * Pulls a small, deterministic set of week-over-week deltas, then asks
 * Claude to narrate them in plain English with one concrete suggestion
 * per material delta. Cached for 6h so an owner refreshing the page
 * doesn't re-burn tokens, but invalidates the moment new activity moves
 * the underlying numbers (cache key includes them).
 */

const SYSTEM = `You write weekly business updates for the owner of a Pakistani real-estate brokerage.

Input: a JSON-ish block of week-over-week metric deltas. Output: a Markdown narrative.

Format:
- 4-6 short bullet points, each leading with the metric name in bold.
- Always state the direction (up/down/flat) and the percentage change when the absolute numbers are meaningful.
- End with a single "## What to do next" section listing 2-3 concrete actions, each one sentence, tied to a specific delta.
- Be honest. If a number dropped, say so plainly — owners trust the report when it doesn't sugar-coat.
- Skip metrics that are zero on both sides (don't pad).
- Currency is PKR; do not convert. Areas (MARLA/KANAL) stay as supplied.
- Never invent metrics not in the input. If something is missing, don't mention it.`;

export interface OwnerWeeklyInsightInput {
  companyId: string;
}

export async function generateOwnerWeeklyInsight(
  input: OwnerWeeklyInsightInput,
): Promise<AiCallResult | AiCallFailure> {
  const metrics = await collectWeeklyDeltas(input.companyId);

  // Quantise the metrics into the input map. Don't round to integers
  // until we're shaping the prompt — otherwise the cache hash would
  // flip every time a single deal moved, which defeats the 6h cache.
  const inputs: Record<string, unknown> = {
    week_ending: metrics.weekEnding,
    leads_this_week: metrics.leadsThisWeek,
    leads_last_week: metrics.leadsLastWeek,
    visits_done_this_week: metrics.visitsThisWeek,
    visits_done_last_week: metrics.visitsLastWeek,
    deals_won_this_week: metrics.dealsThisWeek,
    deals_won_last_week: metrics.dealsLastWeek,
    revenue_pkr_this_week: metrics.revenueThisWeek,
    revenue_pkr_last_week: metrics.revenueLastWeek,
    leads_stuck_in_negotiation: metrics.stuckInNegotiation,
    overdue_payments_pkr: metrics.overduePkr,
    top_agent_this_week: metrics.topAgent ?? "n/a",
    new_inventory_this_week: metrics.newInventory,
  };

  return runAi({
    companyId: input.companyId,
    type: "OWNER_WEEKLY_INSIGHT",
    entity: { type: "COMPANY", id: input.companyId },
    system: SYSTEM,
    prompt: "Produce a weekly narrative update for the owner based on these deltas.",
    inputs,
    maxTokens: 1_200,
    // 6h cache — owners don't refresh constantly, but they may open the
    // report twice on the same morning. Underlying numbers feed the hash
    // so a new deal closing naturally invalidates.
    cacheTtlMs: 6 * 60 * 60_000,
  });
}

interface WeeklyDeltas {
  weekEnding: string;
  leadsThisWeek: number;
  leadsLastWeek: number;
  visitsThisWeek: number;
  visitsLastWeek: number;
  dealsThisWeek: number;
  dealsLastWeek: number;
  revenueThisWeek: number;
  revenueLastWeek: number;
  stuckInNegotiation: number;
  overduePkr: number;
  topAgent: string | null;
  newInventory: number;
}

async function collectWeeklyDeltas(companyId: string): Promise<WeeklyDeltas> {
  const now = new Date();
  const startThisWeek = startOfWeek(now);
  const startLastWeek = new Date(startThisWeek.getTime() - 7 * 86_400_000);

  // Revenue lives on Sale.salePrice + Rental.monthlyRent (no totalValue on
  // Deal). Top agent is via DealAgent role=MAIN. Both require pulling the
  // related rows rather than a single aggregate — fine at week-scale.
  const [
    leadsThisWeek,
    leadsLastWeek,
    visitsThisWeek,
    visitsLastWeek,
    dealsThisWeekRows,
    dealsLastWeekRows,
    stuckInNegotiation,
    overdueRow,
    newInventory,
  ] = await Promise.all([
    prisma.lead.count({ where: { companyId, createdAt: { gte: startThisWeek } } }),
    prisma.lead.count({ where: { companyId, createdAt: { gte: startLastWeek, lt: startThisWeek } } }),
    prisma.showing.count({ where: { companyId, createdAt: { gte: startThisWeek } } }),
    prisma.showing.count({ where: { companyId, createdAt: { gte: startLastWeek, lt: startThisWeek } } }),
    prisma.deal.findMany({
      where: { companyId, status: "CLOSED_WON", closeDate: { gte: startThisWeek } },
      select: {
        sale: { select: { salePrice: true } },
        rental: { select: { monthlyRent: true } },
        agents: { where: { role: "MAIN" }, select: { agent: { select: { name: true } } } },
      },
    }),
    prisma.deal.findMany({
      where: {
        companyId,
        status: "CLOSED_WON",
        closeDate: { gte: startLastWeek, lt: startThisWeek },
      },
      select: { sale: { select: { salePrice: true } }, rental: { select: { monthlyRent: true } } },
    }),
    prisma.lead.count({ where: { companyId, stage: "NEGOTIATION" } }),
    prisma.payment.aggregate({
      where: { companyId, status: "OVERDUE" },
      _sum: { amount: true },
    }),
    prisma.property.count({ where: { companyId, createdAt: { gte: startThisWeek } } }),
  ]);

  // Generic over the row shape so both `dealsThisWeekRows` (which carries
  // an extra `agents` field for the leaderboard tally) and the plain
  // `dealsLastWeekRows` accept the same helper without a type cast.
  const sumDealRevenue = (
    rows: Array<{
      sale: { salePrice: { toString(): string } | number | null } | null;
      rental: { monthlyRent: { toString(): string } | number | null } | null;
    }>,
  ): number =>
    rows.reduce(
      (sum, d) => sum + Number(d.sale?.salePrice ?? 0) + Number(d.rental?.monthlyRent ?? 0),
      0,
    );

  // Top agent: count main-agent appearances in this week's won deals.
  const agentTally = new Map<string, number>();
  for (const d of dealsThisWeekRows) {
    for (const a of d.agents) {
      const name = a.agent?.name;
      if (!name) continue;
      agentTally.set(name, (agentTally.get(name) ?? 0) + 1);
    }
  }
  let topAgent: string | null = null;
  let topCount = 0;
  for (const [name, count] of agentTally) {
    if (count > topCount) {
      topAgent = name;
      topCount = count;
    }
  }

  return {
    weekEnding: now.toISOString().slice(0, 10),
    leadsThisWeek,
    leadsLastWeek,
    visitsThisWeek,
    visitsLastWeek,
    dealsThisWeek: dealsThisWeekRows.length,
    dealsLastWeek: dealsLastWeekRows.length,
    revenueThisWeek: sumDealRevenue(dealsThisWeekRows),
    revenueLastWeek: sumDealRevenue(dealsLastWeekRows),
    stuckInNegotiation,
    overduePkr: Number(overdueRow._sum.amount ?? 0),
    topAgent,
    newInventory,
  };
}

/** Monday at 00:00 local — the "week" boundary the rest of the app uses. */
function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const day = out.getDay(); // 0=Sun … 6=Sat
  const diff = (day + 6) % 7; // shift so Mon=0
  out.setDate(out.getDate() - diff);
  return out;
}
