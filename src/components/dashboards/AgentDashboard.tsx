import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { toNumber, fmtDateTime, compactMoney, localizeDigits } from "@/lib/format";
import { StatCard } from "@/components/ui/StatCard";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { getDict } from "@/lib/i18n/server";

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

  const [{ locale, dict }, today, activeLeads, shares, propsAssigned] = await Promise.all([
    getDict(),
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

  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12 ? dict.dashboard.agent.morning : greetingHour < 18 ? dict.dashboard.agent.afternoon : dict.dashboard.agent.evening;

  return (
    <div className="space-y-6">
      {/* Hero greeting */}
      <div
        className="pz-fade-up relative overflow-hidden rounded-2xl border border-white/15 p-6 shadow-[var(--shadow-soft)]"
        style={{ backgroundImage: "var(--gradient-brand)" }}
      >
        <div className="pointer-events-none absolute inset-0 bg-ink/25" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "radial-gradient(420px 220px at 0% 0%, rgba(255,255,255,0.10), transparent 60%)",
          }}
          aria-hidden
        />
        <div className="relative text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75">{greeting}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {name.split(" ")[0]} {dict.dashboard.agent.heroLead}
          </h1>
          <p className="mt-1.5 text-sm text-white/80">{dict.dashboard.agent.heroSub}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={dict.stats.todaysTasks} value={localizeDigits(today.length, locale)} tone="accent" icon={<Icon name="calendar" />} />
        <StatCard label={dict.stats.activeLeads} value={localizeDigits(activeLeads.length, locale)} tone="ink" icon={<Icon name="target" />} />
        <StatCard label={dict.stats.properties} value={localizeDigits(propsAssigned, locale)} icon={<Icon name="home" />} />
        <StatCard label={dict.stats.commissionPending} value={compactMoney(pending, locale)} sub={`${compactMoney(earned, locale)} ${dict.stats.earned}`} tone="gold" icon={<Icon name="percent" />} />
      </div>

      <Section title={dict.sections.todaysCalendar} action={<Link href="/calendar" className="text-xs font-semibold text-accent hover:text-accent-soft">{dict.common.fullCalendar} →</Link>}>
        {today.length === 0 ? (
          <p className="text-sm text-muted">{dict.empty.noAppointmentsToday}</p>
        ) : (
          <ul className="space-y-2">
            {today.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3 py-2.5 transition hover:border-accent/30">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{e.title}</p>
                  <p className="text-xs text-muted">
                    <span data-keep-latin>{localizeDigits(fmtDateTime(e.startAt), locale)}</span>
                    {e.property ? ` · ${e.property.title}` : ""}
                  </p>
                </div>
                <StatusBadge status={e.type} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={dict.sections.yourActiveLeads} action={<Link href="/leads" className="text-xs font-semibold text-accent hover:text-accent-soft">{dict.common.allLeads} →</Link>}>
        {activeLeads.length === 0 ? (
          <p className="text-sm text-muted">{dict.empty.noActiveLeads}</p>
        ) : (
          <ul className="divide-y divide-line">
            {activeLeads.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{l.client?.name ?? "—"}</p>
                  <p className="truncate text-xs text-muted">{l.property?.title ?? l.prefArea ?? "—"}</p>
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
