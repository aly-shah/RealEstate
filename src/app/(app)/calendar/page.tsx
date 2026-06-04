import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/PageHeader";
import { CalendarClient, type CalEvent } from "./CalendarClient";

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
      take: 500,
    }),
    canAssign
      ? prisma.user.findMany({ where: { companyId: user.companyId, role: "AGENT" }, select: { id: true, name: true } })
      : [],
    prisma.property.findMany({ where: { companyId: user.companyId }, select: { id: true, title: true, reference: true }, take: 200 }),
  ]);

  const items: CalEvent[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    type: e.type,
    status: e.status,
    startAt: e.startAt.toISOString(),
    agentName: e.agent?.name ?? null,
    propertyTitle: e.property?.title ?? null,
  }));

  return (
    <div>
      <PageHeader eyebrow="Schedule" title="Calendar & tasks" subtitle="Plan the team's work — showings, meetings, follow-ups and reminders." />
      <CalendarClient events={items} agents={agents} properties={properties} canAssign={canAssign} />
    </div>
  );
}
