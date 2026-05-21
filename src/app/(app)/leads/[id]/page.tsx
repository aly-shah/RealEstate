import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { compactMoney, humanize, fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { Timeline } from "@/components/ui/Timeline";
import { StageControl, AssignControl } from "@/components/lead/LeadControls";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCompanyUser();

  const lead = await prisma.lead.findFirst({
    where: {
      id,
      companyId: user.companyId,
      ...(user.role === "AGENT" ? { agentId: user.id } : {}),
    },
    include: {
      client: true,
      agent: true,
      property: true,
      events: { orderBy: { startAt: "desc" }, take: 10 },
    },
  });
  if (!lead) notFound();

  const [activity, agents] = await Promise.all([
    prisma.activityLog.findMany({
      where: { companyId: user.companyId, entityType: "LEAD", entityId: id },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    can(user.role, "assignLeadsCalendars")
      ? prisma.user.findMany({ where: { companyId: user.companyId, role: "AGENT" }, select: { id: true, name: true } })
      : [],
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Lead"
        title={lead.client?.name ?? "Unnamed lead"}
        subtitle={[lead.client?.phone, lead.client?.email].filter(Boolean).join(" · ") || undefined}
        action={<StatusBadge status={lead.stage} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Requirements & preferences">
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Source</dt><dd className="font-medium text-ink">{humanize(lead.source)}</dd></div>
              <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Budget</dt><dd className="font-medium text-ink">{lead.budgetMax ? `≤ ${compactMoney(lead.budgetMax)}` : "—"}</dd></div>
              <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Preferred area</dt><dd className="font-medium text-ink">{lead.prefArea ?? "—"}</dd></div>
              <div className="flex justify-between border-b border-line-soft py-2 text-sm"><dt className="text-muted">Property</dt><dd className="font-medium text-ink">{lead.property ? <Link href={`/properties/${lead.property.id}`} className="text-accent">{lead.property.title}</Link> : "—"}</dd></div>
            </dl>
            {lead.requirements && <p className="mt-3 text-sm text-slate">{lead.requirements}</p>}
            {lead.lostReason && <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">Lost: {lead.lostReason}</p>}
          </Section>

          <Section title="Upcoming & past events">
            {lead.events.length === 0 ? (
              <p className="text-sm text-muted">No calendar events linked.</p>
            ) : (
              <ul className="divide-y divide-line">
                {lead.events.map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink">{e.title}</span>
                    <span className="text-xs text-muted">{fmtDateTime(e.startAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Activity timeline">
            <Timeline entries={activity.map((a) => ({ id: a.id, summary: a.summary, createdAt: a.createdAt, who: a.user?.name }))} />
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Move the lead">
            <StageControl id={lead.id} current={lead.stage} />
          </Section>

          <Section title="Assigned agent">
            {can(user.role, "assignLeadsCalendars") ? (
              <AssignControl id={lead.id} currentAgentId={lead.agentId} agents={agents} />
            ) : (
              <p className="text-sm text-ink">{lead.agent?.name ?? "Unassigned"}</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
