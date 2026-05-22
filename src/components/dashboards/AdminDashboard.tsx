import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { outstandingPayments } from "@/lib/metrics";
import { fmtDateTime, fmtDate, localizeDigits } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { getDict } from "@/lib/i18n/server";

export async function AdminDashboard({ companyId }: { companyId: string }) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const [{ locale, dict }, todayEvents, unassignedLeads, visitsToVerify, docsToCheck, commsToApprove, pay] =
    await Promise.all([
      getDict(),
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
        eyebrow={dict.dashboard.admin.eyebrow}
        title={dict.dashboard.admin.title}
        subtitle={dict.dashboard.admin.subtitle}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={dict.stats.leadsToAssign} value={localizeDigits(unassignedLeads, locale)} tone="accent" icon={<Icon name="target" />} />
        <StatCard label={dict.stats.visitsToVerify} value={localizeDigits(visitsToVerify, locale)} tone="ink" icon={<Icon name="flag" />} />
        <StatCard label={dict.stats.docsToCheck} value={localizeDigits(docsToCheck, locale)} icon={<Icon name="document" />} />
        <StatCard label={dict.stats.paymentsDue} value={localizeDigits(pay.count, locale)} sub={dict.stats.pendingOverdue} tone="danger" icon={<Icon name="banknote" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={dict.sections.todaysSchedule} action={<Link href="/calendar" className="text-xs font-semibold text-accent hover:text-accent-soft">{dict.common.calendar} →</Link>}>
          {todayEvents.length === 0 ? (
            <p className="text-sm text-muted">{dict.empty.nothingScheduled}</p>
          ) : (
            <ul className="space-y-2">
              {todayEvents.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 transition hover:border-accent/30">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{e.title}</p>
                    <p className="text-xs text-muted">
                      {e.agent?.name ?? "—"} · <span data-keep-latin>{localizeDigits(fmtDateTime(e.startAt), locale)}</span>
                    </p>
                  </div>
                  <StatusBadge status={e.type} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={dict.sections.commissionsAwaitingApproval} action={<Link href="/commissions" className="text-xs font-semibold text-accent hover:text-accent-soft">{dict.common.viewAll} →</Link>}>
          {commsToApprove.length === 0 ? (
            <p className="text-sm text-muted">{dict.empty.nothingPending}</p>
          ) : (
            <ul className="space-y-2">
              {commsToApprove.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-xl border border-line bg-paper px-3 py-2.5 transition hover:border-accent/30">
                  <div>
                    <p className="text-sm font-semibold text-ink" data-keep-latin>{c.deal.reference}</p>
                    <p className="text-xs text-muted" data-keep-latin>{localizeDigits(fmtDate(c.deal.closeDate), locale)}</p>
                  </div>
                  <Link href={`/commissions/${c.id}`} className="btn-ghost px-3 py-1 text-xs">{dict.common.review}</Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
