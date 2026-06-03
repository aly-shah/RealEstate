import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/session";
import { can } from "@/lib/rbac";
import { agentLeaderboard } from "@/lib/metrics";
import { toNumber, compactMoney, money, humanize, fmtDate, fmtDateTime, initials } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { LastSeenPill } from "@/components/ui/LastSeenPill";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Timeline } from "@/components/ui/Timeline";
import { ActivityCalendar, type ActivityItem } from "@/components/agent/ActivityCalendar";
import { RemarkForm } from "@/components/agent/RemarkForm";

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCapability("viewCompanyReports");
  const companyId = user.companyId!;

  const agent = await prisma.user.findFirst({
    where: { id, companyId, role: "AGENT" },
    include: {
      assignedLeads: { include: { client: true, property: true }, orderBy: { updatedAt: "desc" } },
      propertyLinks: { include: { property: true } },
      showings: { include: { property: true, client: true }, orderBy: { checkInAt: "desc" } },
      dealLinks: { include: { deal: { include: { sale: true, rental: true, property: true } } } },
      commissionShares: { select: { amount: true, paid: true } },
    },
  });
  if (!agent) notFound();

  const [events, activity, board] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { companyId, agentId: id },
      include: { property: true, lead: { include: { client: true } } },
      orderBy: { startAt: "desc" },
    }),
    prisma.activityLog.findMany({
      where: { companyId, userId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    agentLeaderboard(companyId),
  ]);

  // ── Metrics ──────────────────────────────────────────────
  const wonDeals = agent.dealLinks.filter((d) => d.deal.status === "CLOSED_WON");
  const salesClosed = wonDeals.filter((d) => d.deal.type === "SALE").length;
  const rentalsClosed = wonDeals.filter((d) => d.deal.type === "RENTAL").length;
  const revenue = wonDeals.reduce((s, d) => s + toNumber(d.deal.sale?.salePrice) + toNumber(d.deal.rental?.monthlyRent), 0);

  const totalLeads = agent.assignedLeads.length;
  const convertedLeads = agent.assignedLeads.filter((l) => l.stage === "CLOSED_WON").length;
  const lostLeads = agent.assignedLeads.filter((l) => l.stage === "CLOSED_LOST");
  const conversion = totalLeads ? Math.round((convertedLeads / totalLeads) * 100) : 0;

  const clientIds = new Set<string>();
  agent.assignedLeads.forEach((l) => l.clientId && clientIds.add(l.clientId));
  agent.showings.forEach((s) => s.clientId && clientIds.add(s.clientId));

  const propertiesShown = new Set(agent.showings.map((s) => s.propertyId)).size;
  const visitsVerified = agent.showings.filter((s) => s.verification === "VERIFIED").length;

  const earned = agent.commissionShares.filter((s) => s.paid).reduce((s, x) => s + toNumber(x.amount), 0);
  const pending = agent.commissionShares.filter((s) => !s.paid).reduce((s, x) => s + toNumber(x.amount), 0);

  const rankIndex = board.findIndex((b) => b.id === id);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;

  // Attendance: distinct active days (visits checked-in + completed tasks), last 30 days.
  const cutoff = Date.now() - 30 * 86400000;
  const activeDays = new Set<string>();
  agent.showings.forEach((s) => { const t = s.checkInAt ?? s.createdAt; if (t.getTime() >= cutoff) activeDays.add(dayOf(t)); });
  events.forEach((e) => { if (e.status === "DONE" && e.startAt.getTime() >= cutoff) activeDays.add(dayOf(e.startAt)); });

  const followUpsDone = events.filter((e) => e.type === "FOLLOW_UP" && e.status === "DONE").length;

  // ── Calendar feed (events + visits) ──────────────────────
  const calendarItems: ActivityItem[] = [
    ...events.map((e) => ({
      day: dayOf(e.startAt),
      at: e.startAt.toISOString(),
      kind: "EVENT" as const,
      type: e.type,
      title: e.title,
      href: e.propertyId ? `/properties/${e.propertyId}` : undefined,
    })),
    ...agent.showings.map((s) => {
      const t = s.checkInAt ?? s.createdAt;
      return {
        day: dayOf(t),
        at: t.toISOString(),
        kind: "VISIT" as const,
        type: s.verification,
        title: `Showed ${s.property.title}${s.client ? ` to ${s.client.name}` : ""}`,
        href: `/properties/${s.propertyId}`,
      };
    }),
  ];

  const office = can(user.role, "manageUsers");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent profile"
        title={agent.name}
        subtitle={[agent.email, agent.phone].filter(Boolean).join(" · ")}
        action={
          <div className="flex items-center gap-3">
            <LastSeenPill lastSeenAt={agent.lastSeenAt} showNever />
            {rank && <Badge tone={rank === 1 ? "ink" : "neutral"}>Leaderboard #{rank}</Badge>}
            <span className="grid h-11 w-11 place-items-center rounded-full bg-ink text-sm font-semibold text-white">
              {initials(agent.name)}
            </span>
          </div>
        }
      />

      {/* Workload */}
      <Section title="Workload">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Assigned properties" value={agent.propertyLinks.length} tone="ink" />
          <StatCard label="Properties shown" value={propertiesShown} sub={`${agent.showings.length} visits`} />
          <StatCard label="Clients handled" value={clientIds.size} />
          <StatCard label="Active leads" value={totalLeads - convertedLeads - lostLeads.length} sub={`${totalLeads} total`} />
        </div>
      </Section>

      {/* Results */}
      <Section title="Results">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Leads converted" value={convertedLeads} sub={`${conversion}% conversion`} tone="ink" />
          <StatCard label="Sales closed" value={salesClosed} />
          <StatCard label="Rentals closed" value={rentalsClosed} />
          <StatCard label="Revenue generated" value={compactMoney(revenue)} />
        </div>
      </Section>

      {/* Earnings & field */}
      <Section title="Earnings & field activity">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Commission earned" value={compactMoney(earned)} tone="ink" />
          <StatCard label="Commission pending" value={compactMoney(pending)} />
          <StatCard label="Visits verified" value={visitsVerified} sub={`${agent.showings.length} recorded`} />
          <StatCard label="Active days (30d)" value={activeDays.size} sub={`${followUpsDone} follow-ups done`} />
        </div>
      </Section>

      {/* Activity calendar */}
      <Section title="Activity calendar">
        <ActivityCalendar items={calendarItems} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Field visits */}
        <Section title="Field visits & client feedback">
          {agent.showings.length === 0 ? (
            <p className="text-sm text-muted">No visits recorded.</p>
          ) : (
            <ul className="divide-y divide-line">
              {agent.showings.slice(0, 10).map((s) => (
                <li key={s.id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/properties/${s.propertyId}`} className="truncate font-medium text-ink hover:text-accent">{s.property.title}</Link>
                    <StatusBadge status={s.verification} />
                  </div>
                  <p className="text-xs text-muted">
                    {s.client?.name ?? "—"} · {fmtDateTime(s.checkInAt ?? s.createdAt)}
                    {s.checkInLat ? ` · 📍 ${s.checkInLat.toFixed(3)}, ${s.checkInLng?.toFixed(3)}` : s.manualLocation ? ` · ${s.manualLocation}` : ""}
                  </p>
                  {s.clientFeedback && <p className="mt-0.5 text-xs italic text-slate">“{s.clientFeedback}”</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Lost deals */}
        <Section title="Lost deals & reasons">
          {lostLeads.length === 0 ? (
            <p className="text-sm text-muted">No lost deals — nice work.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lostLeads.map((l) => (
                <li key={l.id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">{l.client?.name ?? "Unnamed"}</span>
                    <Badge tone="danger">Lost</Badge>
                  </div>
                  <p className="text-xs text-muted">{l.lostReason ?? "No reason recorded"}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Recent leads */}
        <Section title="Recent leads">
          {agent.assignedLeads.length === 0 ? (
            <p className="text-sm text-muted">No leads assigned.</p>
          ) : (
            <ul className="divide-y divide-line">
              {agent.assignedLeads.slice(0, 8).map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2">
                  <Link href={`/leads/${l.id}`} className="text-sm font-medium text-ink hover:text-accent">{l.client?.name ?? "Unnamed"}</Link>
                  <StatusBadge status={l.stage} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Assigned properties */}
        <Section title="Assigned properties">
          {agent.propertyLinks.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="divide-y divide-line">
              {agent.propertyLinks.map((pl) => (
                <li key={pl.propertyId} className="flex items-center justify-between py-2">
                  <Link href={`/properties/${pl.propertyId}`} className="truncate text-sm font-medium text-ink hover:text-accent">{pl.property.title}</Link>
                  <StatusBadge status={pl.property.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Performance + remarks + activity log */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Performance">
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-muted">Conversion rate</span>
              <span className="font-semibold text-ink">{conversion}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-accent" style={{ width: `${conversion}%` }} />
            </div>
          </div>
          <div className="flex justify-between border-b border-line-soft py-2 text-sm"><span className="text-muted">Total commission</span><span className="font-medium text-ink">{money(earned + pending)}</span></div>
          <div className="flex justify-between border-b border-line-soft py-2 text-sm"><span className="text-muted">Leaderboard</span><span className="font-medium text-ink">{rank ? `#${rank} of ${board.length}` : "—"}</span></div>
          <div className="flex justify-between py-2 text-sm"><span className="text-muted">Deals won</span><span className="font-medium text-ink">{wonDeals.length}</span></div>
        </Section>

        {office && (
          <Section title="Admin remarks (private)">
            <RemarkForm agentId={agent.id} initial={agent.remark} />
          </Section>
        )}

        <Section title="Daily activity log" className={office ? "" : "lg:col-span-2"}>
          <Timeline entries={activity.map((a) => ({ id: a.id, summary: a.summary, createdAt: a.createdAt }))} />
        </Section>
      </div>
    </div>
  );
}
