import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { StatusBadge } from "@/components/ui/Badge";
import { StepForm } from "../SequenceForms";
import { updateSequence, deleteSequence, deleteStep, moveStep } from "../actions";

const TRIGGER_STAGES = [
  "NEW", "CONTACTED", "INTERESTED", "SITE_VISIT", "PROPERTY_SHOWN", "NEGOTIATION", "TOKEN_BOOKING", "PAYMENT",
];

const KIND_LABEL: Record<string, string> = { TASK: "Agent task", WHATSAPP_TEMPLATE: "WhatsApp" };

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
      _count: { select: { enrollments: true } },
    },
  });
  if (!seq) notFound();

  const approvedTemplates = await prisma.whatsAppTemplate.findMany({
    where: { companyId, status: "APPROVED" },
    orderBy: { name: "asc" },
    select: { name: true, language: true },
  });

  const lastIdx = seq.steps.length - 1;

  return (
    <div>
      <PageHeader
        eyebrow="Sequence"
        title={seq.name}
        subtitle={`${seq.steps.length} step${seq.steps.length === 1 ? "" : "s"} · ${seq._count.enrollments} enrolled`}
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Steps">
            {seq.steps.length === 0 ? (
              <p className="mb-4 text-sm text-muted">No steps yet — add the first one below.</p>
            ) : (
              <ol className="mb-4 space-y-2">
                {seq.steps.map((step, i) => (
                  <li key={step.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <span className="font-semibold text-ink">{i + 1}. {KIND_LABEL[step.kind] ?? step.kind}</span>
                      <span className="ml-2 text-xs text-muted">wait {step.delayHours}h</span>
                      <div className="truncate text-xs text-slate">
                        {step.kind === "WHATSAPP_TEMPLATE"
                          ? `Template: ${step.templateName} (${step.templateLang})`
                          : step.taskTitle}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
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
                  </li>
                ))}
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
