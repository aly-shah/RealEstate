import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  agentLeaderboard,
  commissionTotals,
  inventorySnapshot,
  leadsByStage,
  monthlyRevenue,
  monthStart,
  outstandingPayments,
  salesRevenue,
} from "@/lib/metrics";
import { compactMoney, money, initials } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { Icon } from "@/components/ui/Icon";
import {
  InventoryDonut,
  LeadsFunnelChart,
  RevenueTrendChart,
} from "./DashboardCharts";

export async function OwnerDashboard({ companyId }: { companyId: string }) {
  const [revMonth, revAll, comm, pay, board, inv, pipeline, revTrend, leadStages] =
    await Promise.all([
      salesRevenue(companyId, monthStart()),
      salesRevenue(companyId),
      commissionTotals(companyId),
      outstandingPayments(companyId),
      agentLeaderboard(companyId),
      inventorySnapshot(companyId),
      prisma.deal.count({
        where: { companyId, status: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } },
      }),
      monthlyRevenue(companyId, 6),
      leadsByStage(companyId),
    ]);

  // Month-over-month delta for the headline stat.
  const lastMonthRev = revTrend.length >= 2 ? revTrend[revTrend.length - 2].revenue : 0;
  const delta =
    lastMonthRev > 0
      ? Math.round(((revMonth - lastMonthRev) / lastMonthRev) * 100)
      : revMonth > 0
        ? 100
        : 0;
  const deltaLabel =
    delta === 0
      ? "Flat vs last month"
      : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs last month`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Owner dashboard"
        title="How the business is doing"
        subtitle="Revenue, commissions, pipeline and the people driving it — in one view."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Revenue this month"
          value={compactMoney(revMonth)}
          sub={deltaLabel}
          tone="accent"
          icon={<Icon name="banknote" />}
        />
        <StatCard
          label="Commission pending"
          value={compactMoney(comm.pending)}
          sub={`${compactMoney(comm.paid)} paid`}
          tone="gold"
          icon={<Icon name="percent" />}
        />
        <StatCard
          label="Open deals"
          value={pipeline}
          sub="In the pipeline"
          tone="ink"
          icon={<Icon name="exchange" />}
        />
        <StatCard
          label="Overdue payments"
          value={compactMoney(pay.overdue)}
          sub={`${pay.count} outstanding`}
          tone="danger"
          icon={<Icon name="alert" />}
        />
      </div>

      {/* Revenue trend + inventory donut */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Section
          title="Revenue trend · last 6 months"
          className="lg:col-span-2"
          action={
            <Link
              href="/reports"
              className="text-xs font-semibold text-accent hover:text-accent-soft"
            >
              Reports →
            </Link>
          }
        >
          <RevenueTrendChart data={revTrend} />
          <p className="mt-3 text-xs text-muted">
            All-time revenue: <span className="font-semibold text-ink">{money(revAll)}</span>
          </p>
        </Section>

        <Section title="Inventory mix">
          <InventoryDonut data={inv} />
        </Section>
      </div>

      {/* Funnel + leaderboard */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Section
          title="Lead pipeline"
          className="lg:col-span-3"
          action={
            <Link
              href="/leads"
              className="text-xs font-semibold text-accent hover:text-accent-soft"
            >
              All leads →
            </Link>
          }
        >
          <LeadsFunnelChart data={leadStages} />
        </Section>

        <Section
          title="Agent leaderboard"
          className="lg:col-span-2"
          action={
            <Link
              href="/agents"
              className="text-xs font-semibold text-accent hover:text-accent-soft"
            >
              View all →
            </Link>
          }
        >
          {board.length === 0 ? (
            <p className="text-sm text-muted">No agents yet.</p>
          ) : (
            <ol className="space-y-2">
              {board.slice(0, 5).map((a, i) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5 transition hover:border-accent/30 hover:shadow-[var(--shadow-card)]"
                >
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-xl text-sm font-bold ${
                      i === 0
                        ? "bg-accent text-white shadow-[var(--shadow-card)]"
                        : i === 1
                          ? "bg-accent-wash text-accent"
                          : "bg-subtle text-slate"
                    }`}
                    style={i === 0 ? { backgroundImage: "var(--gradient-brand)" } : undefined}
                  >
                    {i + 1}
                  </span>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-ink/5 text-[11px] font-semibold text-ink">
                    {initials(a.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{a.name}</p>
                    <p className="text-xs text-muted">
                      {a.dealsWon} won · {a.conversion}% conversion · {a.leads} leads
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-ink">
                    {compactMoney(a.revenue)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  );
}
