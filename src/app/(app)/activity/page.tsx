import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/session";
import { fmtDateTime, humanize, initials } from "@/lib/format";
import { actionMeta, dotClass } from "@/lib/activity-meta";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { parsePage } from "@/lib/pagination";
import { ActivityTrend, EntityBreakdown } from "@/components/activity/ActivityCharts";

const ENTITY_TYPES = ["PROPERTY", "LEAD", "DEAL", "COMMISSION", "USER", "DOCUMENT", "PAYMENT", "COMMISSION_RULE"] as const;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthDay = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

function dayLabel(s: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(s); d.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function relative(date: Date): string {
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtDateTime(date);
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; user?: string; page?: string; pageSize?: string }>;
}) {
  const me = await requireCapability("viewCompanyReports");
  const companyId = me.companyId!;
  const sp = await searchParams;
  const { page, pageSize, skip } = parsePage(sp, 50);

  const filterWhere: Prisma.ActivityLogWhereInput = {
    companyId,
    ...(sp.entity ? { entityType: sp.entity } : {}),
    ...(sp.user ? { userId: sp.user } : {}),
  };
  const since = new Date(); since.setDate(since.getDate() - 29); since.setHours(0, 0, 0, 0);
  const startOfToday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  const sevenDaysAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; })();

  const [logs, logsTotal, users, last30, byEntity, todayCount, weekCount] = await Promise.all([
    prisma.activityLog.findMany({ where: filterWhere, include: { user: true }, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
    prisma.activityLog.count({ where: filterWhere }),
    prisma.user.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.activityLog.findMany({ where: { companyId, createdAt: { gte: since } }, select: { createdAt: true, userId: true, user: { select: { name: true } } } }),
    prisma.activityLog.groupBy({ by: ["entityType"], where: { companyId, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.activityLog.count({ where: { companyId, createdAt: { gte: startOfToday } } }),
    prisma.activityLog.count({ where: { companyId, createdAt: { gte: sevenDaysAgo } } }),
  ]);

  // 30-day trend (fill empty days with 0) + top-actor tally
  const counts = new Map<string, number>();
  const userTally = new Map<string, { name: string; count: number }>();
  for (const l of last30) {
    const k = dayKey(l.createdAt);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (l.userId) {
      const t = userTally.get(l.userId) ?? { name: l.user?.name ?? "—", count: 0 };
      t.count += 1;
      userTally.set(l.userId, t);
    }
  }
  const trend: { day: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    const k = dayKey(d);
    trend.push({ day: monthDay(k), count: counts.get(k) ?? 0 });
  }

  const breakdown = byEntity
    .map((g) => ({ entity: humanize(g.entityType), count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  const topUsers = [...userTally.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  const topUser = topUsers[0];

  // Group filtered logs by calendar day for the timeline.
  const groups = new Map<string, typeof logs>();
  for (const l of logs) {
    const k = dayKey(l.createdAt);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Audit"
        title="Activity log"
        subtitle="Every meaningful action across the company — at a glance, then in detail."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Today" value={todayCount} tone="accent" />
        <StatCard label="Last 7 days" value={weekCount} />
        <StatCard label="Last 30 days" value={last30.length} />
        <StatCard label="Most active" value={topUser?.name.split(" ")[0] ?? "—"} sub={topUser ? `${topUser.count} actions` : undefined} tone="gold" />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Activity · last 30 days" className="lg:col-span-2">
          <ActivityTrend data={trend} />
        </Section>
        <Section title="By entity">
          {breakdown.length === 0 ? <p className="text-sm text-muted">No data.</p> : <EntityBreakdown data={breakdown} />}
        </Section>
      </div>

      {/* Most active people */}
      {topUsers.length > 0 && (
        <Section title="Most active people · last 30 days">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {topUsers.map((u, i) => (
              <li key={u.name + i} className="flex items-center gap-3 rounded-lg border border-line bg-paper p-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-xs font-semibold text-white">{initials(u.name)}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{u.name}</p>
                  <p className="text-xs text-muted">{u.count} actions</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <FilterBar
        showSearch={false}
        filters={[
          { key: "entity", label: "Entity", options: ENTITY_TYPES },
          { key: "user", label: "User", options: users.map((u) => ({ value: u.id, label: u.name })) },
        ]}
      />

      {logs.length === 0 ? (
        <EmptyState title="No matching activity" hint="Try clearing filters above." />
      ) : (
        <>
        <div className="space-y-6">
          {[...groups.entries()].map(([k, items]) => (
            <section key={k} className="surface overflow-hidden">
              <header className="flex items-center justify-between border-b border-line bg-subtle px-5 py-2.5">
                <h3 className="text-sm font-semibold text-ink">{dayLabel(k)}</h3>
                <span className="text-xs text-muted">{items.length} action{items.length === 1 ? "" : "s"}</span>
              </header>
              <ul className="divide-y divide-line-soft">
                {items.map((l) => {
                  const meta = actionMeta(l.action);
                  // Drop the redundant entity prefix from the action ("deal.created" → "created").
                  const verb = humanize(l.action.includes(".") ? l.action.split(".").slice(1).join(".") : l.action);
                  return (
                    <li key={l.id} className="flex items-start gap-3 px-5 py-3 transition hover:bg-line-soft/40">
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${dotClass(meta.tone)}`} aria-hidden>
                        <span className="text-sm font-semibold">{meta.icon}</span>
                      </span>
                      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <div className="min-w-0">
                          <p className="text-sm text-ink">{l.summary}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                            <span className="font-medium text-slate">{l.user?.name ?? "System"}</span>
                            <Badge tone="neutral">{humanize(l.entityType)}</Badge>
                            <span className="text-slate">{verb}</span>
                          </div>
                        </div>
                        <time
                          title={fmtDateTime(l.createdAt)}
                          className="shrink-0 text-xs text-muted"
                        >
                          {relative(l.createdAt)}
                        </time>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <Pagination total={logsTotal} page={page} pageSize={pageSize} />
        </>
      )}
    </div>
  );
}
