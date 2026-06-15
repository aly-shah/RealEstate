import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreateSequenceForm } from "./SequenceForms";
import { humanizeHours } from "./_lib";

type EnrollCounts = { ACTIVE: number; COMPLETED: number; EXITED: number };

export default async function SequencesPage() {
  const user = await requireCapability("assignLeadsCalendars");
  const companyId = user.companyId!;

  const [sequences, enrollGroups, approvedCount] = await Promise.all([
    prisma.dripSequence.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        triggerStage: true,
        active: true,
        steps: { orderBy: { order: "asc" }, select: { kind: true, delayHours: true } },
      },
    }),
    prisma.dripEnrollment.groupBy({
      by: ["sequenceId", "status"],
      where: { companyId },
      _count: { _all: true },
    }),
    prisma.whatsAppTemplate.count({ where: { companyId, status: "APPROVED" } }),
  ]);

  // sequenceId → per-status enrolment counts.
  const enroll = new Map<string, EnrollCounts>();
  for (const g of enrollGroups) {
    const e = enroll.get(g.sequenceId) ?? { ACTIVE: 0, COMPLETED: 0, EXITED: 0 };
    e[g.status as keyof EnrollCounts] = g._count._all;
    enroll.set(g.sequenceId, e);
  }

  const liveCount = sequences.filter((s) => s.active).length;
  const totalActive = [...enroll.values()].reduce((n, e) => n + e.ACTIVE, 0);
  const totalCompleted = [...enroll.values()].reduce((n, e) => n + e.COMPLETED, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Automation"
        title="Sequences"
        subtitle="Multi-step nurture campaigns — leads enrol automatically when they reach the trigger stage, then receive timed WhatsApp messages and agent tasks."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Live sequences" value={liveCount} tone="accent" sub={`${sequences.length} total`} />
        <StatCard label="Leads in flight" value={totalActive} tone="ink" sub="being nurtured now" />
        <StatCard label="Completed" value={totalCompleted} tone="ok" sub="finished all steps" />
        <StatCard label="Approved templates" value={approvedCount} tone="default" sub="for WhatsApp steps" />
      </div>

      <Section title="New sequence" className="mb-6">
        <CreateSequenceForm />
      </Section>

      <Section title="All sequences">
        {sequences.length === 0 ? (
          <EmptyState title="No sequences yet" hint="Create one above to start automating follow-up." />
        ) : (
          <div className="space-y-3">
            {sequences.map((s) => {
              const e = enroll.get(s.id) ?? { ACTIVE: 0, COMPLETED: 0, EXITED: 0 };
              const wa = s.steps.filter((st) => st.kind === "WHATSAPP_TEMPLATE").length;
              const tasks = s.steps.length - wa;
              const span = s.steps.reduce((sum, st) => sum + st.delayHours, 0);
              const needsSteps = s.active && s.steps.length === 0;
              const noTrigger = s.active && !s.triggerStage;

              return (
                <Link
                  key={s.id}
                  href={`/sequences/${s.id}`}
                  className="group block rounded-2xl border border-line bg-paper p-4 transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[var(--shadow-pop)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-ink group-hover:text-accent">{s.name}</h3>
                        {s.active
                          ? <StatusBadge status="ACTIVE" />
                          : <span className="chip border-line bg-line-soft text-slate">Draft</span>}
                        {needsSteps && <span className="chip border-warn/25 bg-warn-bg text-warn">Needs steps</span>}
                        {noTrigger && <span className="chip border-line bg-line-soft text-muted">No trigger</span>}
                      </div>

                      <p className="mt-1 text-xs text-muted">
                        {s.triggerStage
                          ? <>Enrols at <span className="font-medium text-slate">{humanize(s.triggerStage)}</span></>
                          : "Manual enrolment only"}
                        {s.steps.length > 0 && (
                          <> · {wa} WhatsApp · {tasks} task{tasks === 1 ? "" : "s"} · runs over {humanizeHours(span)}</>
                        )}
                      </p>

                      {/* Flow preview */}
                      <div className="mt-3 flex items-center gap-1.5">
                        {s.steps.length === 0 ? (
                          <span className="text-xs text-muted">No steps yet</span>
                        ) : (
                          s.steps.slice(0, 12).map((st, i) => (
                            <span
                              key={i}
                              title={`${st.kind === "WHATSAPP_TEMPLATE" ? "WhatsApp" : "Task"} · wait ${humanizeHours(st.delayHours)}`}
                              className={`h-2.5 w-2.5 rounded-full ${st.kind === "WHATSAPP_TEMPLATE" ? "bg-accent" : "bg-slate"}`}
                            />
                          ))
                        )}
                        {s.steps.length > 12 && <span className="text-xs text-muted">+{s.steps.length - 12}</span>}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-5 text-right">
                      <div>
                        <p className="text-lg font-semibold leading-none text-ink">{e.ACTIVE}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted">in flight</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold leading-none text-ink">{e.COMPLETED}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted">completed</p>
                      </div>
                      <span className="text-accent transition group-hover:translate-x-0.5" aria-hidden>→</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
