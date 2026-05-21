import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { toNumber, fmtDateTime, compactMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";

interface AgentDashboardProps {
  companyId: string;
  userId: string;
  name: string;
}

export async function AgentDashboard({ companyId, userId, name }: AgentDashboardProps) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const [today, activeLeads, shares, propsAssigned] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { companyId, agentId: userId, startAt: { gte: startOfDay, lt: endOfDay } },
      include: { property: true, lead: { include: { client: true } } },
      orderBy: { startAt: "asc" },
    }),
    prisma.lead.findMany({
      where: { companyId, agentId: userId, stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } },
      include: { client: true, property: true },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    prisma.commissionShare.findMany({
      where: { userId, commission: { companyId } },
      select: { amount: true, paid: true },
    }),
    prisma.propertyAgent.count({ where: { agentId: userId } }),
  ]);

  const earned = shares.filter((s) => s.paid).reduce((s, x) => s + toNumber(x.amount), 0);
  const pending = shares.filter((s) => !s.paid).reduce((s, x) => s + toNumber(x.amount), 0);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`Hello, ${name.split(" ")[0]}`} title="Your day" subtitle="Today's schedule, your leads and your earnings." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Today's tasks" value={today.length} tone="ink" />
        <StatCard label="Active leads" value={activeLeads.length} tone="accent" />
        <StatCard label="Properties" value={propsAssigned} />
        <StatCard label="Commission pending" value={compactMoney(pending)} sub={`${compactMoney(earned)} earned`} />
      </div>

      <Section title="Today's calendar" action={<Link href="/calendar" className="text-xs font-semibold text-accent">Full calendar →</Link>}>
        {today.length === 0 ? (
          <p className="text-sm text-muted">No appointments today. Time to chase some leads!</p>
        ) : (
          <ul className="space-y-2">
            {today.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{e.title}</p>
                  <p className="text-xs text-muted">
                    {fmtDateTime(e.startAt)}
                    {e.property ? ` · ${e.property.title}` : ""}
                  </p>
                </div>
                <StatusBadge status={e.type} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Your active leads" action={<Link href="/leads" className="text-xs font-semibold text-accent">All leads →</Link>}>
        {activeLeads.length === 0 ? (
          <p className="text-sm text-muted">No active leads assigned.</p>
        ) : (
          <ul className="divide-y divide-line">
            {activeLeads.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{l.client?.name ?? "Unnamed lead"}</p>
                  <p className="truncate text-xs text-muted">{l.property?.title ?? l.prefArea ?? "No property linked"}</p>
                </div>
                <Link href={`/leads/${l.id}`} className="shrink-0">
                  <StatusBadge status={l.stage} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
