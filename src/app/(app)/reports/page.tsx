import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  salesRevenue,
  monthStart,
  commissionTotals,
  outstandingPayments,
  agentLeaderboard,
  inventorySnapshot,
} from "@/lib/metrics";
import { money, compactMoney, humanize, toNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { RevenueTrend, LeadFunnel } from "@/components/reports/ReportCharts";

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

export default async function ReportsPage() {
  const user = await requireCapability("viewCompanyReports");
  const companyId = user.companyId!;
  const since = monthStart();

  const [
    revMonth, revAll, comm, pay, board, inv,
    salesCount, rentalsCount, lostLeads, leadsByStage, dealers,
  ] = await Promise.all([
    salesRevenue(companyId, since),
    salesRevenue(companyId),
    commissionTotals(companyId),
    outstandingPayments(companyId),
    agentLeaderboard(companyId),
    inventorySnapshot(companyId),
    prisma.deal.count({ where: { companyId, type: "SALE", status: "CLOSED_WON", closeDate: { gte: since } } }),
    prisma.deal.count({ where: { companyId, type: "RENTAL", status: "CLOSED_WON", closeDate: { gte: since } } }),
    prisma.lead.findMany({ where: { companyId, stage: "CLOSED_LOST" }, select: { lostReason: true }, take: 200 }),
    prisma.lead.groupBy({ by: ["stage"], where: { companyId }, _count: { _all: true } }),
    prisma.dealer.findMany({
      where: { companyId },
      select: { id: true, name: true, deals: { where: { status: "CLOSED_WON" }, select: { sale: { select: { salePrice: true } }, rental: { select: { monthlyRent: true } } } } },
    }),
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

  // Tally lost-lead reasons.
  const reasonMap = new Map<string, number>();
  for (const l of lostLeads) {
    const r = l.lostReason?.trim() || "No reason given";
    reasonMap.set(r, (reasonMap.get(r) ?? 0) + 1);
  }
  const reasons = [...reasonMap.entries()].sort((a, b) => b[1] - a[1]);

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
    { type: "leads", label: "Leads" },
    { type: "commissions", label: "Commissions" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        subtitle="The day-to-day data turned into decisions — this month and all-time."
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Revenue trend · last 6 months">
          <RevenueTrend data={revenueTrend} />
        </Section>
        <Section title="Lead funnel">
          <LeadFunnel data={funnel} />
        </Section>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Revenue (month)" value={compactMoney(revMonth)} sub={`${money(revAll)} all-time`} tone="ink" />
        <StatCard label="Sales / Rentals" value={`${salesCount} / ${rentalsCount}`} sub="closed this month" tone="accent" />
        <StatCard label="Lead conversion" value={`${conversion}%`} sub={`${wonLeads}/${totalLeads} won`} />
        <StatCard label="Outstanding" value={compactMoney(pay.total)} sub={`${compactMoney(pay.overdue)} overdue`} />
      </div>

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
      </div>
    </div>
  );
}
