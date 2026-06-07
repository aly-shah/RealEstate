import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  agentLeaderboard,
  commissionTotals,
  companyMetricsTag,
  inventorySnapshot,
  leadsByStage,
  monthlyRevenue,
  monthStart,
  outstandingPayments,
  salesRevenue,
} from "@/lib/metrics";
import { cachedQuery } from "@/lib/query-optimizer";
import { compactMoney, money, initials, localizeDigits } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { Icon } from "@/components/ui/Icon";
import { getDict } from "@/lib/i18n/server";
import {
  InventoryDonut,
  LeadsFunnelChart,
  RevenueTrendChart,
} from "./DashboardCharts";

export async function OwnerDashboard({ companyId }: { companyId: string }) {
  // Locale stays per-request (reads the cookie); the metric bundle is
  // company-scoped and locale-independent, so it's cached for 60s under the
  // tenant's `:metrics` tag. Money mutations (deal close, payment, commission)
  // call invalidateTags(`co:${companyId}:metrics`) for immediate freshness;
  // the TTL is the backstop for lead/inventory changes.
  const { locale, dict } = await getDict();
  const { revMonth, revAll, comm, pay, board, inv, pipeline, revTrend, leadStages } =
    await cachedQuery(
      `co:${companyId}:dash:owner`,
      { ttlMs: 60_000, tags: [companyMetricsTag(companyId)] },
      async () => {
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
        return { revMonth, revAll, comm, pay, board, inv, pipeline, revTrend, leadStages };
      },
    );

  const lastMonthRev = revTrend.length >= 2 ? revTrend[revTrend.length - 2].revenue : 0;
  const delta =
    lastMonthRev > 0
      ? Math.round(((revMonth - lastMonthRev) / lastMonthRev) * 100)
      : revMonth > 0
        ? 100
        : 0;
  const deltaLabel =
    delta === 0
      ? dict.dashboard.deltaFlat
      : `${delta > 0 ? "▲" : "▼"} ${localizeDigits(Math.abs(delta), locale)}% ${dict.dashboard.deltaUp}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={dict.dashboard.owner.eyebrow}
        title={dict.dashboard.owner.title}
        subtitle={dict.dashboard.owner.subtitle}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={dict.stats.revenueThisMonth}
          value={compactMoney(revMonth, locale)}
          sub={deltaLabel}
          tone="accent"
          icon={<Icon name="banknote" />}
        />
        <StatCard
          label={dict.stats.commissionPending}
          value={compactMoney(comm.pending, locale)}
          sub={`${compactMoney(comm.paid, locale)} ${dict.stats.paid}`}
          tone="gold"
          icon={<Icon name="percent" />}
        />
        <StatCard
          label={dict.stats.openDeals}
          value={localizeDigits(pipeline, locale)}
          sub={dict.stats.inPipeline}
          tone="ink"
          icon={<Icon name="exchange" />}
        />
        <StatCard
          label={dict.stats.overduePayments}
          value={compactMoney(pay.overdue, locale)}
          sub={`${localizeDigits(pay.count, locale)} ${dict.stats.outstanding}`}
          tone="danger"
          icon={<Icon name="alert" />}
        />
      </div>

      {/* Revenue trend + inventory donut */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Section
          title={dict.sections.revenueTrend}
          className="lg:col-span-2"
          action={
            <Link href="/reports" className="text-xs font-semibold text-accent hover:text-accent-soft">
              {dict.common.reports} →
            </Link>
          }
        >
          <RevenueTrendChart data={revTrend} locale={locale} labels={{ peak: dict.common.peak }} />
          <p className="mt-3 text-xs text-muted">
            {dict.dashboard.allTimeRevenue}{" "}
            <span className="font-semibold text-ink">{money(revAll, locale)}</span>
          </p>
        </Section>

        <Section title={dict.sections.inventoryMix}>
          <InventoryDonut
            data={inv}
            locale={locale}
            statusLabels={dict.status}
            totalLabel={dict.common.total}
          />
        </Section>
      </div>

      {/* Funnel + leaderboard */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Section
          title={dict.sections.leadPipeline}
          className="lg:col-span-3"
          action={
            <Link href="/leads" className="text-xs font-semibold text-accent hover:text-accent-soft">
              {dict.common.allLeads} →
            </Link>
          }
        >
          <LeadsFunnelChart data={leadStages} locale={locale} stageLabels={dict.status} />
        </Section>

        <Section
          title={dict.sections.agentLeaderboard}
          className="lg:col-span-2"
          action={
            <Link href="/agents" className="text-xs font-semibold text-accent hover:text-accent-soft">
              {dict.common.viewAll} →
            </Link>
          }
        >
          {board.length === 0 ? (
            <p className="text-sm text-muted">{dict.empty.noAgents}</p>
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
                    {localizeDigits(i + 1, locale)}
                  </span>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-ink/5 text-[11px] font-semibold text-ink" data-keep-latin>
                    {initials(a.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{a.name}</p>
                    <p className="text-xs text-muted">
                      {localizeDigits(a.dealsWon, locale)} {dict.units.won} · {localizeDigits(a.conversion, locale)}% {dict.units.conversion} · {localizeDigits(a.leads, locale)} {dict.units.leads}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-ink">
                    {compactMoney(a.revenue, locale)}
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
