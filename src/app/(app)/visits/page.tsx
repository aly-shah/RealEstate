import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompanyUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { fmtDateTime, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { CheckInForm } from "./CheckInForm";
import { VerifyButtons } from "./VerifyButtons";

export default async function VisitsPage() {
  const user = await requireCompanyUser();
  const canVerify = can(user.role, "assignLeadsCalendars");

  const where: Prisma.ShowingWhereInput = {
    companyId: user.companyId,
    ...(user.role === "AGENT" ? { agentId: user.id } : {}),
  };

  const [showings, properties, clients] = await Promise.all([
    prisma.showing.findMany({
      where,
      include: { agent: true, client: true, property: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.property.findMany({ where: { companyId: user.companyId }, select: { id: true, title: true, reference: true }, take: 200 }),
    prisma.client.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true }, take: 200 }),
  ]);

  return (
    <div>
      <PageHeader eyebrow="Field" title="Visit tracking" subtitle="Every showing recorded — GPS or manual — with feedback and verification." />

      {can(user.role, "updateLeadsVisits") && <CheckInForm properties={properties} clients={clients} />}

      {showings.length === 0 ? (
        <EmptyState title="No visits recorded" hint="Record a showing after you show a property." />
      ) : (
        <Section title="Showings">
          <ul className="divide-y divide-line">
            {showings.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{s.property.title}</p>
                  <p className="text-xs text-muted">
                    {s.agent.name} → {s.client?.name ?? "—"} · {fmtDateTime(s.checkInAt ?? s.createdAt)}
                    {s.checkInLat ? ` · 📍 ${s.checkInLat.toFixed(3)},${s.checkInLng?.toFixed(3)}` : s.manualLocation ? ` · ${s.manualLocation}` : ""}
                  </p>
                  {s.clientFeedback && <p className="mt-1 text-xs italic text-slate">“{s.clientFeedback}”</p>}
                </div>
                <div className="flex items-center gap-2">
                  {s.interestLevel && (
                    <Badge tone={s.interestLevel === "HIGH" ? "ok" : s.interestLevel === "NONE" ? "danger" : "neutral"}>
                      {humanize(s.interestLevel)} interest
                    </Badge>
                  )}
                  <StatusBadge status={s.verification} />
                  {canVerify && s.verification === "PENDING" && <VerifyButtons id={s.id} />}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
