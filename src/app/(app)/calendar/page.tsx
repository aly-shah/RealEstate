import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/PageHeader";
import { CalendarClient, type CalEvent } from "./CalendarClient";

function dayLabel(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export default async function CalendarPage() {
  const user = await requireCompanyUser();
  const canAssign = can(user.role, "assignLeadsCalendars");

  const where: Prisma.CalendarEventWhereInput = {
    companyId: user.companyId,
    ...(user.role === "AGENT" ? { agentId: user.id } : {}),
  };

  const [events, agents, properties] = await Promise.all([
    prisma.calendarEvent.findMany({
      where,
      include: { agent: true, property: true },
      orderBy: { startAt: "asc" },
      take: 200,
    }),
    canAssign
      ? prisma.user.findMany({ where: { companyId: user.companyId, role: "AGENT" }, select: { id: true, name: true } })
      : [],
    prisma.property.findMany({ where: { companyId: user.companyId }, select: { id: true, title: true, reference: true }, take: 200 }),
  ]);

  // Group by calendar day.
  const map = new Map<string, CalEvent[]>();
  for (const e of events) {
    const label = dayLabel(e.startAt);
    const item: CalEvent = {
      id: e.id,
      title: e.title,
      type: e.type,
      status: e.status,
      startAt: e.startAt.toISOString(),
      agentName: e.agent?.name ?? null,
      propertyTitle: e.property?.title ?? null,
    };
    map.set(label, [...(map.get(label) ?? []), item]);
  }
  const groups = Array.from(map.entries()).map(([label, evts]) => ({ label, events: evts }));

  return (
    <div>
      <PageHeader eyebrow="Schedule" title="Calendar & tasks" subtitle="Plan the team's work — showings, meetings, follow-ups and reminders." />
      <CalendarClient groups={groups} agents={agents} properties={properties} canAssign={canAssign} />
    </div>
  );
}
