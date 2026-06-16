import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  salesRevenue,
  monthStart,
  commissionTotals,
  outstandingPayments,
  agentLeaderboard,
  inventorySnapshot,
  payoutSummary,
} from "@/lib/metrics";
import { money, compactMoney, humanize, toNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { RevenueTrend, LeadFunnel } from "@/components/reports/ReportCharts";
import {
  parseDateRange,
  fmtIsoDate,
  monthlySalesVsRentals,
  leadSourceConversion,
  funnelDropoff,
  paymentOverdueAging,
  propertyInventoryAging,
  visitVerificationStats,
  grossCommissionByAgent,
  pipelineForecast,
} from "@/lib/reports";
import { DateRangeFilter } from "@/components/reports/DateRangeFilter";
import { OwnerInsightPanel } from "@/components/reports/OwnerInsightPanel";
import { aiUsageSnapshot } from "@/lib/ai/budget";
import {
  SalesVsRentalsChart,
  SourceConversionChart,
  FunnelDropoffChart,
  OverdueAgingChart,
  InventoryAgingChart,
} from "@/components/reports/Phase7Charts";

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <span className="w-40 shrink-0 truncate text-slate">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-28 shrink-0 text-right font-medium text-ink">{compactMoney(value)}</span>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireCapability("viewCompanyReports");
  const companyId = user.companyId!;
  const sp = await searchParams;
  // Date range gates the new Phase-7 widgets. The legacy "this month" widgets
  // keep using monthStart() so existing dashboards/exports stay stable.
  const range = parseDateRange(sp);
  const since = monthStart();

  // Phase-9: surface the AI weekly-insight panel only when AI is enabled
  // for this tenant + server. requireCapability already restricts the page
  // to OWNER/ADMIN/SUPER_ADMIN, so we don't re-check role here.
  const ai = await aiUsageSnapshot(companyId);
  const showAi = !!ai && ai.serverConfigured && ai.aiEnabled && ai.limit > 0;

  const [
    revMonth, revAll, comm, pay, board, inv,
    salesCount, rentalsCount, lostLeads, lostDeals, leadsByStage, dealers, payouts,
    salesVsRentals, sourceConversion, funnelSteps, overdueAging, inventoryAging, visitStats,
    gci, forecast,
  ] = await Promise.all([
    salesRevenue(companyId, since),
    salesRevenue(companyId),
    commissionTotals(companyId),
    outstandingPayments(companyId),
    agentLeaderboard(companyId),
    inventorySnapshot(companyId),
    prisma.deal.count({ where: { companyId, type: "SALE", status: "CLOSED_WON", closeDate: { gte: since } } }),
    prisma.deal.count({ where: { companyId, type: "RENTAL", status: "CLOSED_WON", closeDate: { gte: since } } }),
    // Enriched lost-lead pull: bring source + agent so we can slice the
    // analytics three ways below.
    prisma.lead.findMany({
      where: { companyId, stage: "CLOSED_LOST" },
      select: {
        lostReason: true,
        source: true,
        agent: { select: { name: true } },
      },
      take: 500,
    }),
    // Lost deals — same shape; agent comes from the MAIN DealAgent.
    prisma.deal.findMany({
      where: { companyId, status: "CLOSED_LOST" },
      select: {
        lostReason: true,
        agents: { where: { role: "MAIN" }, include: { agent: { select: { name: true } } } },
      },
      take: 500,
    }),
    prisma.lead.groupBy({ by: ["stage"], where: { companyId }, _count: { _all: true } }),
    prisma.dealer.findMany({
      where: { companyId },
      select: { id: true, name: true, deals: { where: { status: "CLOSED_WON" }, select: { sale: { select: { salePrice: true } }, rental: { select: { monthlyRent: true } } } } },
    }),
    payoutSummary(companyId),
    // Phase 7 — date-range scoped where applicable.
    monthlySalesVsRentals(companyId, range),
    leadSourceConversion(companyId, range),
    funnelDropoff(companyId, range),
    paymentOverdueAging(companyId),
    propertyInventoryAging(companyId),
    visitVerificationStats(companyId, range),
    grossCommissionByAgent(companyId, range),
    pipelineForecast(companyId),
  ]);

  // Area performance from closed deals.
  const closedDeals = await prisma.deal.findMany({
    where: { companyId, status: "CLOSED_WON" },
    select: { property: { select: { area: true } }, sale: { select: { salePrice: true } }, rental: { select: { monthlyRent: true } } },
  });
  const areaMap = new Map<string, number>();
  for (const d of closedDeals) {
    const area = d.property.area ?? "Unspecified";
    areaMap.set(area, (areaMap.get(area) ?? 0) + toNumber(d.sale?.salePrice) + toNumber(d.rental?.monthlyRent));
  }
  const areas = [...areaMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const areaMax = Math.max(1, ...areas.map(([, v]) => v));

  const dealerPerf = dealers
    .map((d) => ({ name: d.name, value: d.deals.reduce((s, x) => s + toNumber(x.sale?.salePrice) + toNumber(x.rental?.monthlyRent), 0), deals: d.deals.length }))
    .sort((a, b) => b.value - a.value);
  const dealerMax = Math.max(1, ...dealerPerf.map((d) => d.value));

  const totalLeads = leadsByStage.reduce((s, g) => s + g._count._all, 0);
  const wonLeads = leadsByStage.find((g) => g.stage === "CLOSED_WON")?._count._all ?? 0;
  const conversion = totalLeads ? Math.round((wonLeads / totalLeads) * 100) : 0;

  // Tally lost-lead reasons three ways: by reason, by agent, by source. The
  // same loop also feeds the lost-deals analytics — deals are smaller in
  // volume but more financially meaningful, so they get their own column.
  const reasonMap = new Map<string, number>();
  const agentLostMap = new Map<string, number>();
  const sourceLostMap = new Map<string, number>();
  for (const l of lostLeads) {
    const r = l.lostReason?.trim() || "No reason given";
    reasonMap.set(r, (reasonMap.get(r) ?? 0) + 1);

    const a = l.agent?.name ?? "Unassigned";
    agentLostMap.set(a, (agentLostMap.get(a) ?? 0) + 1);

    const s = humanize(l.source);
    sourceLostMap.set(s, (sourceLostMap.get(s) ?? 0) + 1);
  }
  const reasons = [...reasonMap.entries()].sort((a, b) => b[1] - a[1]);
  const agentLosses = [...agentLostMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const sourceLosses = [...sourceLostMap.entries()].sort((a, b) => b[1] - a[1]);

  // Lost-deal reasons — separate map so we can render them side-by-side.
  const dealReasonMap = new Map<string, number>();
  const dealAgentLostMap = new Map<string, number>();
  for (const d of lostDeals) {
    const r = d.lostReason?.trim() || "No reason given";
    dealReasonMap.set(r, (dealReasonMap.get(r) ?? 0) + 1);
    const a = d.agents[0]?.agent?.name ?? "Unattributed";
    dealAgentLostMap.set(a, (dealAgentLostMap.get(a) ?? 0) + 1);
  }
  const dealReasons = [...dealReasonMap.entries()].sort((a, b) => b[1] - a[1]);
  const dealAgentLosses = [...dealAgentLostMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Revenue trend — closed-deal value over the last 6 months.
  const sixAgo = new Date();
  sixAgo.setMonth(sixAgo.getMonth() - 5);
  sixAgo.setDate(1);
  sixAgo.setHours(0, 0, 0, 0);
  const trendDeals = await prisma.deal.findMany({
    where: { companyId, status: "CLOSED_WON", closeDate: { gte: sixAgo } },
    select: { closeDate: true, sale: { select: { salePrice: true } }, rental: { select: { monthlyRent: true } } },
  });
  const months: { key: string; month: string; revenue: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(sixAgo);
    d.setMonth(d.getMonth() + i);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, month: d.toLocaleDateString("en-GB", { month: "short" }), revenue: 0 });
  }
  for (const d of trendDeals) {
    if (!d.closeDate) continue;
    const m = months.find((x) => x.key === `${d.closeDate!.getFullYear()}-${d.closeDate!.getMonth()}`);
    if (m) m.revenue += toNumber(d.sale?.salePrice) + toNumber(d.rental?.monthlyRent);
  }
  const revenueTrend = months.map((m) => ({ month: m.month, revenue: m.revenue }));

  // Lead funnel — ordered progression stages.
  const FUNNEL = ["NEW", "CONTACTED", "INTERESTED", "SITE_VISIT", "PROPERTY_SHOWN", "NEGOTIATION", "TOKEN_BOOKING", "PAYMENT", "CLOSED_WON"];
  const stageCount = Object.fromEntries(leadsByStage.map((g) => [g.stage, g._count._all]));
  const funnel = FUNNEL.map((s) => ({ stage: humanize(s), count: stageCount[s] ?? 0 }));

  const exports = [
    { type: "agents", label: "Agents" },
    { type: "deals", label: "Deals" },
    { type: "payments", label: "Payments" },
    { type: "invoices", label: "Invoices" },
    { type: "leads", label: "Leads" },
    { type: "commissions", label: "Commissions" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        subtitle={`Window: ${fmtIsoDate(range.from)} → ${fmtIsoDate(range.to)}. Some widgets (leaderboard, commission totals) are all-time and aren't gated by this range.`}
        action={
          <details className="relative">
            <summary className="btn-ghost cursor-pointer list-none">↧ Export CSV</summary>
            <div className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-md border border-line bg-white py-1 shadow-sm">
              {exports.map((e) => (
                <a key={e.type} href={`/api/export?type=${e.type}`} className="block px-3 py-1.5 text-sm text-slate hover:bg-line-soft hover:text-ink">
                  {e.label}
                </a>
              ))}
            </div>
          </details>
        }
      />

      <DateRangeFilter defaultFrom={fmtIsoDate(range.from)} defaultTo={fmtIsoDate(range.to)} />

      {showAi && (
        <Section title="AI · weekly insight">
          <OwnerInsightPanel />
        </Section>
      )}

      {/* Phase 7: Revenue panel — sales/rentals split + month total. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Sales vs rentals · in window" className="lg:col-span-2">
          <SalesVsRentalsChart data={salesVsRentals.points} />
          <p className="mt-2 text-xs text-muted">
            Stacked area: sales (indigo) + rentals (green). Each rental month uses the monthly rent, not annualised.
            {salesVsRentals.clamped && (
              <span className="ms-1 text-warn">
                Long window — showing the last 24 months only.
              </span>
            )}
          </p>
        </Section>
        <Section title="Revenue this month">
          <p className="text-3xl font-semibold tracking-tight text-ink">{compactMoney(revMonth)}</p>
          <p className="mt-1 text-xs text-muted">{salesCount} sales · {rentalsCount} rentals closed</p>
          <p className="mt-3 text-xs text-muted">All-time: <span className="font-medium text-ink">{money(revAll)}</span></p>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Revenue trend · last 6 months (all-time view)">
          <RevenueTrend data={revenueTrend} />
        </Section>
        <Section title="Lead funnel (current state)">
          <LeadFunnel data={funnel} />
        </Section>
      </div>

      {/* Phase 7: Pipeline panel — source conversion + retention drop-off. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Lead source conversion · in window">
          {sourceConversion.length === 0 ? (
            <p className="text-sm text-muted">No leads created in this window.</p>
          ) : (
            <SourceConversionChart data={sourceConversion} />
          )}
        </Section>
        <Section title="Funnel · stage-to-stage retention">
          <FunnelDropoffChart data={funnelSteps} />
          <p className="mt-3 text-xs text-muted">
            Each row shows the % of leads that made it from the previous stage. Bars are cumulative — a lead at NEGOTIATION counts for every prior stage.
          </p>
        </Section>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Revenue (month)" value={compactMoney(revMonth)} sub={`${money(revAll)} all-time`} tone="ink" />
        <StatCard label="Sales / Rentals" value={`${salesCount} / ${rentalsCount}`} sub="closed this month" tone="accent" />
        <StatCard label="Lead conversion" value={`${conversion}%`} sub={`${wonLeads}/${totalLeads} won`} />
        <StatCard label="Outstanding" value={compactMoney(pay.total)} sub={`${compactMoney(pay.overdue)} overdue`} />
      </div>

      <Section title="Pipeline forecast (weighted)">
        <p className="mb-4 text-sm text-muted">
          Open-deal value weighted by each stage&rsquo;s win probability
          {forecast.calibration.calibrated
            ? `, calibrated to your ${Math.round((forecast.calibration.rate ?? 0) * 100)}% historical close rate (${forecast.calibration.won + forecast.calibration.lost} decided deals)`
            : " (default weights — close more deals to calibrate to your own history)"}
          . &ldquo;Expected GCI&rdquo; applies each deal&rsquo;s gross-commission&nbsp;%.
        </p>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <StatCard label="Weighted pipeline" value={compactMoney(forecast.totalWeightedValue)} sub={`${compactMoney(forecast.totalOpenValue)} open`} tone="ink" />
          <StatCard label="Expected GCI" value={compactMoney(forecast.totalWeightedGci)} sub="risk-weighted" tone="accent" />
          <StatCard label="Next 90 days" value={compactMoney(forecast.next90Weighted)} sub="by est. close date" />
          <StatCard label="Open deals" value={String(forecast.openDeals)} sub="in pipeline" />
        </div>
        {forecast.byStage.length === 0 ? (
          <p className="text-sm text-muted">No open deals in the pipeline.</p>
        ) : (
          <div>
            {forecast.byStage.map((s) => (
              <div key={s.status} className="flex items-center justify-between border-b border-line-soft py-2 text-sm last:border-0">
                <span className="text-ink">
                  {humanize(s.status)}
                  <span className="ml-2 text-xs text-muted">{s.deals} deal{s.deals === 1 ? "" : "s"} · {Math.round(s.weight * 100)}% win</span>
                </span>
                <span className="font-medium text-ink">
                  {money(s.weightedValue)} <span className="text-xs text-muted">of {compactMoney(s.openValue)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Gross Commission Income · by agent · in window">
        {gci.rows.length === 0 ? (
          <p className="text-sm text-muted">
            No GCI in this window. Set a deal&rsquo;s gross-commission&nbsp;% to populate this.
          </p>
        ) : (
          <>
            <div className="mb-3 flex justify-between border-b border-line-soft py-2 text-sm">
              <span className="text-muted">Total GCI</span>
              <span className="font-semibold text-ink">{money(gci.totalGci)}</span>
            </div>
            {gci.rows.slice(0, 8).map((r) => (
              <BarRow
                key={r.agentId}
                label={`${r.name} · ${r.deals} deal${r.deals === 1 ? "" : "s"}`}
                value={r.gci}
                max={Math.max(1, gci.rows[0].gci)}
              />
            ))}
            {gci.unattributed > 0 && (
              <p className="mt-2 text-xs text-muted">{money(gci.unattributed)} from deals with no main agent.</p>
            )}
          </>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Agent leaderboard">
          {board.length === 0 ? <p className="text-sm text-muted">No data.</p> : board.slice(0, 8).map((a) => (
            <BarRow key={a.id} label={a.name} value={a.revenue} max={Math.max(1, board[0].revenue)} />
          ))}
        </Section>

        <Section title="Area-wise performance">
          {areas.length === 0 ? <p className="text-sm text-muted">No closed deals yet.</p> : areas.map(([area, v]) => (
            <BarRow key={area} label={area} value={v} max={areaMax} />
          ))}
        </Section>

        <Section title="Dealer performance">
          {dealerPerf.length === 0 ? <p className="text-sm text-muted">No dealers.</p> : dealerPerf.map((d) => (
            <BarRow key={d.name} label={`${d.name} (${d.deals})`} value={d.value} max={dealerMax} />
          ))}
        </Section>

        <Section title="Property status">
          <ul className="space-y-2">
            {Object.entries(inv).length === 0 && <p className="text-sm text-muted">No properties.</p>}
            {Object.entries(inv).map(([s, c]) => (
              <li key={s} className="flex items-center justify-between text-sm">
                <span className="text-slate">{humanize(s)}</span>
                <span className="font-bold text-ink">{c}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Commission summary">
          <div className="flex justify-between border-b border-line-soft py-2 text-sm"><span className="text-muted">Total</span><span className="font-medium text-ink">{money(comm.total)}</span></div>
          <div className="flex justify-between border-b border-line-soft py-2 text-sm"><span className="text-muted">Paid</span><span className="font-medium text-ok">{money(comm.paid)}</span></div>
          <div className="flex justify-between py-2 text-sm"><span className="text-muted">Pending</span><span className="font-medium text-warn">{money(comm.pending)}</span></div>
        </Section>

        <Section title="Commission payouts · approved + paid">
          {payouts.byRecipient.length === 0 ? (
            <p className="text-sm text-muted">No approved commissions yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(payouts.byParty).map(([p, t]) => (
                  <div key={p} className="rounded-lg border border-line bg-line-soft/50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{humanize(p)}</p>
                    <p className="font-medium text-ink">{compactMoney(t.paid + t.pending)}</p>
                    <p className="text-[11px] text-muted">
                      <span className="text-ok">{compactMoney(t.paid)} paid</span>
                      {" · "}
                      <span className="text-warn">{compactMoney(t.pending)} pending</span>
                    </p>
                  </div>
                ))}
              </div>
              <ul className="divide-y divide-line">
                {payouts.byRecipient.slice(0, 10).map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium text-ink">{r.name}</p>
                      <p className="text-[11px] text-muted">{humanize(r.party)}</p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="text-ok">{compactMoney(r.paid)} paid</p>
                      <p className="text-warn">{compactMoney(r.pending)} pending</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="Lost-lead reasons">
          {reasons.length === 0 ? <p className="text-sm text-muted">No lost leads recorded.</p> : (
            <ul className="space-y-2">
              {reasons.map(([r, c]) => (
                <li key={r} className="flex items-center justify-between text-sm">
                  <span className="text-slate">{r}</span>
                  <span className="font-bold text-ink">{c}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Phase 4: lost-source + lost-by-agent slices for coaching + source-mix decisions */}
        <Section title="Lost leads by source">
          {sourceLosses.length === 0 ? (
            <p className="text-sm text-muted">No data yet.</p>
          ) : (
            <ul className="space-y-2">
              {sourceLosses.map(([s, c]) => (
                <li key={s} className="flex items-center justify-between text-sm">
                  <span className="text-slate">{s}</span>
                  <span className="font-bold text-ink">{c}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Lost leads by agent">
          {agentLosses.length === 0 ? (
            <p className="text-sm text-muted">No data yet.</p>
          ) : (
            <ul className="space-y-2">
              {agentLosses.map(([a, c]) => (
                <li key={a} className="flex items-center justify-between text-sm">
                  <span className="text-slate">{a}</span>
                  <span className="font-bold text-ink">{c}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Lost deals · by reason">
          {dealReasons.length === 0 ? (
            <p className="text-sm text-muted">No lost deals recorded.</p>
          ) : (
            <ul className="space-y-2">
              {dealReasons.map(([r, c]) => (
                <li key={r} className="flex items-center justify-between text-sm">
                  <span className="text-slate">{r}</span>
                  <span className="font-bold text-ink">{c}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Lost deals · by agent">
          {dealAgentLosses.length === 0 ? (
            <p className="text-sm text-muted">No data yet.</p>
          ) : (
            <ul className="space-y-2">
              {dealAgentLosses.map(([a, c]) => (
                <li key={a} className="flex items-center justify-between text-sm">
                  <span className="text-slate">{a}</span>
                  <span className="font-bold text-ink">{c}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Phase 7: Operations panel — visit verification + inventory aging. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Visit verification · in window" className="lg:col-span-1">
          {visitStats.total === 0 ? (
            <p className="text-sm text-muted">No showings recorded in this window.</p>
          ) : (
            <>
              <div className="flex items-baseline gap-3">
                <p className="text-4xl font-semibold tracking-tight text-ink">{visitStats.verificationRate}%</p>
                <p className="text-xs text-muted">{visitStats.verified} of {visitStats.total} verified</p>
              </div>
              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Pending</dt><dd className="font-medium text-warn">{visitStats.pending}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Flagged</dt><dd className="font-medium text-warn">{visitStats.flagged}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Rejected</dt><dd className="font-medium text-danger">{visitStats.rejected}</dd></div>
              </dl>
            </>
          )}
        </Section>

        <Section title="Property inventory aging" className="lg:col-span-2">
          {inventoryAging.every((b) => b.count === 0) ? (
            <p className="text-sm text-muted">No active inventory.</p>
          ) : (
            <>
              <InventoryAgingChart data={inventoryAging} />
              <p className="mt-3 text-xs text-muted">
                Days since listing for properties still on the market (AVAILABLE / RESERVED / UNDER_NEGOTIATION / PENDING_VERIFICATION).
                Anything in the 180+ bucket likely needs a price drop or fresh photos.
              </p>
            </>
          )}
        </Section>
      </div>

      {/* Phase 7: Finance panel — overdue aging buckets. */}
      <Section title="Overdue payments · aging">
        {overdueAging.every((b) => b.count === 0) ? (
          <p className="text-sm text-muted">No overdue payments — nice.</p>
        ) : (
          <>
            <OverdueAgingChart data={overdueAging} />
            <p className="mt-3 text-xs text-muted">
              Standard accounting buckets (current → 30 → 60 → 90+). Hover a bar for the total amount in that band.
            </p>
          </>
        )}
      </Section>
    </div>
  );
}
