import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  agentLeaderboard,
  commissionTotals,
  inventorySnapshot,
  monthStart,
  outstandingPayments,
  salesRevenue,
} from "@/lib/metrics";
import { compactMoney, humanize, money } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";

export async function OwnerDashboard({ companyId }: { companyId: string }) {
  const [revMonth, revAll, comm, pay, board, inv, pipeline] = await Promise.all([
    salesRevenue(companyId, monthStart()),
    salesRevenue(companyId),
    commissionTotals(companyId),
    outstandingPayments(companyId),
    agentLeaderboard(companyId),
    inventorySnapshot(companyId),
    prisma.deal.count({ where: { companyId, status: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Owner dashboard"
        title="How the business is doing"
        subtitle="Revenue, commissions, pipeline and the people driving it — in one view."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Revenue this month" value={compactMoney(revMonth)} sub={`${money(revAll)} all-time`} tone="ink" />
        <StatCard label="Commission pending" value={compactMoney(comm.pending)} sub={`${compactMoney(comm.paid)} paid`} tone="accent" />
        <StatCard label="Open deals" value={pipeline} sub="In the pipeline" />
        <StatCard label="Overdue payments" value={compactMoney(pay.overdue)} sub={`${pay.count} outstanding`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section
          title="Agent leaderboard"
          className="lg:col-span-2"
          action={<Link href="/agents" className="text-xs font-semibold text-accent">View all →</Link>}
        >
          {board.length === 0 ? (
            <p className="text-sm text-muted">No agents yet.</p>
          ) : (
            <ol className="space-y-2">
              {board.slice(0, 5).map((a, i) => (
                <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold ${i === 0 ? "bg-ink text-white" : "border border-line text-muted"}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                    <p className="text-xs text-muted">{a.dealsWon} won · {a.conversion}% conversion · {a.leads} leads</p>
                  </div>
                  <span className="text-sm font-semibold text-ink">{compactMoney(a.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Inventory snapshot">
          <ul className="space-y-2">
            {Object.entries(inv).length === 0 && <p className="text-sm text-muted">No properties yet.</p>}
            {Object.entries(inv).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-sm">
                <Badge tone="neutral">{humanize(status)}</Badge>
                <span className="font-bold text-ink">{count}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
