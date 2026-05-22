import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { outstandingPayments } from "@/lib/metrics";
import { fmtDateTime, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

export async function AdminDashboard({ companyId }: { companyId: string }) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const [todayEvents, unassignedLeads, visitsToVerify, docsToCheck, commsToApprove, pay] =
    await Promise.all([
      prisma.calendarEvent.findMany({
        where: { companyId, startAt: { gte: startOfDay, lt: endOfDay } },
        include: { agent: true, property: true },
        orderBy: { startAt: "asc" },
        take: 8,
      }),
      prisma.lead.count({ where: { companyId, agentId: null, stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } } }),
      prisma.showing.count({ where: { companyId, verification: "PENDING" } }),
      prisma.document.count({ where: { companyId, verification: "PENDING" } }),
      prisma.commission.findMany({
        where: { companyId, status: "PENDING_APPROVAL" },
        include: { deal: true },
        take: 5,
      }),
      outstandingPayments(companyId),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin dashboard"
        title="What needs attention today"
        subtitle="Operations at a glance — assignments, verifications and approvals."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Leads to assign" value={unassignedLeads} tone="accent" icon={<Icon name="target" />} />
        <StatCard label="Visits to verify" value={visitsToVerify} tone="ink" icon={<Icon name="flag" />} />
        <StatCard label="Docs to check" value={docsToCheck} icon={<Icon name="document" />} />
        <StatCard label="Payments due" value={pay.count} sub="pending + overdue" tone="danger" icon={<Icon name="banknote" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Today's schedule" action={<Link href="/calendar" className="text-xs font-semibold text-accent">Calendar →</Link>}>
          {todayEvents.length === 0 ? (
            <p className="text-sm text-muted">Nothing scheduled today.</p>
          ) : (
            <ul className="space-y-2">
              {todayEvents.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{e.title}</p>
                    <p className="text-xs text-muted">{e.agent?.name ?? "Unassigned"} · {fmtDateTime(e.startAt)}</p>
                  </div>
                  <StatusBadge status={e.type} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Commissions awaiting approval" action={<Link href="/commissions" className="text-xs font-semibold text-accent">All →</Link>}>
          {commsToApprove.length === 0 ? (
            <p className="text-sm text-muted">Nothing pending approval.</p>
          ) : (
            <ul className="space-y-2">
              {commsToApprove.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">{c.deal.reference}</p>
                    <p className="text-xs text-muted">Closed {fmtDate(c.deal.closeDate)}</p>
                  </div>
                  <Link href={`/commissions/${c.id}`} className="btn-ghost px-3 py-1 text-xs">Review</Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
