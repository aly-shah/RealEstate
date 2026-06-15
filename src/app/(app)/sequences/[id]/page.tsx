import Link from "next/link";
import { notFound } from "next/navigation";
import type { DripStepKind } from "@prisma/client";
import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/Badge";
import { StepForm } from "../SequenceForms";
import { updateSequence, deleteSequence, deleteStep, moveStep } from "../actions";
import { humanizeHours, dayLabel, relFromNow } from "../_lib";

const TRIGGER_STAGES = [
  "NEW", "CONTACTED", "INTERESTED", "SITE_VISIT", "PROPERTY_SHOWN", "NEGOTIATION", "TOKEN_BOOKING", "PAYMENT",
];

const KIND_LABEL: Record<DripStepKind, string> = { TASK: "Agent task", WHATSAPP_TEMPLATE: "WhatsApp message" };

function StepIcon({ kind }: { kind: DripStepKind }) {
  if (kind === "WHATSAPP_TEMPLATE") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export default async function SequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCapability("assignLeadsCalendars");
  const companyId = user.companyId!;

  const seq = await prisma.dripSequence.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      name: true,
      triggerStage: true,
      active: true,
      steps: {
        orderBy: { order: "asc" },
        select: { id: true, order: true, kind: true, delayHours: true, templateName: true, templateLang: true, taskTitle: true },
      },
    },
  });
  if (!seq) notFound();

  const [approvedTemplates, enrollGroups, inFlight] = await Promise.all([
    prisma.whatsAppTemplate.findMany({
      where: { companyId, status: "APPROVED" },
      orderBy: { name: "asc" },
      select: { name: true, language: true },
    }),
    prisma.dripEnrollment.groupBy({
      by: ["status"],
      where: { sequenceId: seq.id },
      _count: { _all: true },
    }),
    prisma.dripEnrollment.findMany({
      where: { sequenceId: seq.id, status: "ACTIVE" },
      orderBy: { nextRunAt: "asc" },
      take: 8,
      select: { id: true, currentStep: true, nextRunAt: true, lead: { select: { client: { select: { name: true } } } } },
    }),
  ]);

  const counts = { ACTIVE: 0, COMPLETED: 0, EXITED: 0 };
  for (const g of enrollGroups) counts[g.status as keyof typeof counts] = g._count._all;

  // Cumulative offset from enrolment for the timeline rail (pure: each step sums
  // the delays of every step up to and including it).
  const timeline = seq.steps.map((s, i) => ({
    ...s,
    cumulative: seq.steps.slice(0, i + 1).reduce((sum, st) => sum + st.delayHours, 0),
  }));
  const lastIdx = seq.steps.length - 1;

  return (
    <div>
      <PageHeader
        eyebrow="Sequence"
        title={seq.name}
        subtitle={`${seq.steps.length} step${seq.steps.length === 1 ? "" : "s"} · ${counts.ACTIVE + counts.COMPLETED + counts.EXITED} enrolled all-time`}
        action={seq.active ? <StatusBadge status="ACTIVE" /> : <span className="chip border-line bg-line-soft text-slate">Draft</span>}
      />

      <div className="mb-3">
        <Link href="/sequences" className="text-xs font-semibold text-accent">← All sequences</Link>
      </div>

      {seq.active && seq.steps.length === 0 && (
        <p className="mb-4 rounded-xl border border-warn/30 bg-warn-bg px-3 py-2 text-sm text-warn">
          This sequence is active but has no steps — add at least one below.
        </p>
      )}
      {seq.active && !seq.triggerStage && (
        <p className="mb-4 rounded-xl border border-line bg-line-soft px-3 py-2 text-sm text-muted">
          No trigger stage set — leads won&rsquo;t enrol automatically (manual enrolment only).
        </p>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="In flight" value={counts.ACTIVE} tone="accent" sub="active right now" />
        <StatCard label="Completed" value={counts.COMPLETED} tone="ok" sub="finished all steps" />
        <StatCard label="Exited early" value={counts.EXITED} tone="default" sub="opted out / lead closed" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Flow">
            {seq.steps.length === 0 ? (
              <p className="mb-5 text-sm text-muted">No steps yet — add the first one below to build the flow.</p>
            ) : (
              <ol className="relative mb-5 ml-3 space-y-3 border-l-2 border-line pl-6">
                {/* Trigger node */}
                <li className="relative">
                  <span className="absolute -left-[1.72rem] top-1 grid h-6 w-6 place-items-center rounded-full bg-accent text-[11px] text-white">▶</span>
                  <div className="rounded-xl border border-accent/20 bg-accent-wash/40 px-4 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">Trigger · Day 0</p>
                    <p className="text-sm text-ink">
                      {seq.triggerStage
                        ? <>Lead reaches <span className="font-medium">“{humanize(seq.triggerStage)}”</span></>
                        : "Manual enrolment only"}
                    </p>
                  </div>
                </li>

                {/* Step nodes */}
                {timeline.map((step, i) => (
                  <li key={step.id} className="group relative">
                    <span className="absolute -left-[1.72rem] top-1 grid h-6 w-6 place-items-center rounded-full border border-line bg-paper text-slate">
                      <StepIcon kind={step.kind} />
                    </span>
                    <div className="rounded-xl border border-line bg-paper px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className={`chip ${step.kind === "WHATSAPP_TEMPLATE" ? "border-accent/25 bg-accent-wash text-accent" : "border-line bg-line-soft text-slate"}`}>
                              {KIND_LABEL[step.kind]}
                            </span>
                            <span className="text-muted">
                              waits {humanizeHours(step.delayHours)} · ~{dayLabel(step.cumulative)}
                            </span>
                          </div>
                          <p className="mt-1.5 truncate text-sm font-medium text-ink">
                            {step.kind === "WHATSAPP_TEMPLATE"
                              ? `${step.templateName} (${step.templateLang})`
                              : step.taskTitle}
                          </p>
                          {step.kind === "WHATSAPP_TEMPLATE" && (
                            <p className="mt-0.5 text-xs text-muted">Sent to the lead&rsquo;s client, personalised with their name.</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                          <form action={moveStep}>
                            <input type="hidden" name="id" value={step.id} />
                            <input type="hidden" name="dir" value="up" />
                            <button className="btn-ghost px-2 py-1 text-xs" disabled={i === 0} aria-label="Move up">↑</button>
                          </form>
                          <form action={moveStep}>
                            <input type="hidden" name="id" value={step.id} />
                            <input type="hidden" name="dir" value="down" />
                            <button className="btn-ghost px-2 py-1 text-xs" disabled={i === lastIdx} aria-label="Move down">↓</button>
                          </form>
                          <form action={deleteStep}>
                            <input type="hidden" name="id" value={step.id} />
                            <button className="btn-ghost px-2 py-1 text-xs text-danger" aria-label="Delete step">✕</button>
                          </form>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}

                {/* Completion node */}
                <li className="relative">
                  <span className="absolute -left-[1.72rem] top-1 grid h-6 w-6 place-items-center rounded-full border border-ok/40 bg-ok-bg text-[11px] text-ok">✓</span>
                  <p className="py-1 text-xs font-medium text-muted">Sequence complete</p>
                </li>
              </ol>
            )}
            <StepForm sequenceId={seq.id} approved={approvedTemplates} />
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Settings">
            <form action={updateSequence} className="space-y-3">
              <input type="hidden" name="id" value={seq.id} />
              <div>
                <label className="label" htmlFor="name">Name</label>
                <input id="name" name="name" className="field" defaultValue={seq.name} required />
              </div>
              <div>
                <label className="label" htmlFor="triggerStage">Trigger stage</label>
                <select id="triggerStage" name="triggerStage" className="field" defaultValue={seq.triggerStage ?? ""}>
                  <option value="">Manual only</option>
                  {TRIGGER_STAGES.map((s) => (
                    <option key={s} value={s}>{humanize(s)}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">Leads enrol when they enter this stage.</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="active" defaultChecked={seq.active} className="accent-ink" />
                Active
              </label>
              <button type="submit" className="btn-accent w-full justify-center">Save</button>
            </form>
          </Section>

          <Section title="Currently nurturing">
            {inFlight.length === 0 ? (
              <p className="text-sm text-muted">No leads in this sequence right now.</p>
            ) : (
              <ul className="space-y-2">
                {inFlight.map((en) => (
                  <li key={en.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{en.lead.client?.name ?? "Unknown lead"}</p>
                      <p className="text-xs text-muted">Step {Math.min(en.currentStep + 1, seq.steps.length || 1)} of {seq.steps.length}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate">{relFromNow(en.nextRunAt)}</span>
                  </li>
                ))}
                {counts.ACTIVE > inFlight.length && (
                  <li className="px-1 pt-1 text-xs text-muted">and {counts.ACTIVE - inFlight.length} more…</li>
                )}
              </ul>
            )}
          </Section>

          <Section title="Danger zone">
            <form action={deleteSequence}>
              <input type="hidden" name="id" value={seq.id} />
              <button className="btn-ghost w-full justify-center text-xs text-danger">Delete sequence</button>
            </form>
            <p className="mt-2 text-xs text-muted">Removes the sequence, its steps, and all enrolments.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
