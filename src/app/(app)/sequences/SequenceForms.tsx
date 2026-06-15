"use client";

import { useActionState, useState } from "react";
import { createSequence, addStep, type FormState } from "./actions";
import { humanize } from "@/lib/format";

const TRIGGER_STAGES = [
  "NEW", "CONTACTED", "INTERESTED", "SITE_VISIT", "PROPERTY_SHOWN", "NEGOTIATION", "TOKEN_BOOKING", "PAYMENT",
];

/** Inline "new sequence" form on the list page. */
export function CreateSequenceForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createSequence, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[14rem] flex-1">
        <label className="label" htmlFor="name">Sequence name</label>
        <input id="name" name="name" className="field" placeholder="e.g. New-lead nurture" required />
      </div>
      <div>
        <label className="label" htmlFor="triggerStage">Trigger stage</label>
        <select id="triggerStage" name="triggerStage" className="field" defaultValue="NEW">
          <option value="">Manual only</option>
          {TRIGGER_STAGES.map((s) => (
            <option key={s} value={s}>{humanize(s)}</option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className="btn-accent">{pending ? "Creating…" : "Create"}</button>
      {state.error && <p className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}

/** Add-a-step form — toggles between a WhatsApp template and an agent task. */
export function StepForm({
  sequenceId,
  approved,
}: {
  sequenceId: string;
  approved: { name: string; language: string }[];
}) {
  const [kind, setKind] = useState<"TASK" | "WHATSAPP_TEMPLATE">("TASK");

  return (
    <form action={addStep} className="space-y-3 rounded-2xl border border-dashed border-line bg-paper p-4">
      <input type="hidden" name="sequenceId" value={sequenceId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="kind">Step type</label>
          <select
            id="kind"
            name="kind"
            className="field"
            value={kind}
            onChange={(e) => setKind(e.target.value as "TASK" | "WHATSAPP_TEMPLATE")}
          >
            <option value="TASK">Agent task</option>
            <option value="WHATSAPP_TEMPLATE">WhatsApp template</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="delayHours">Wait (hours)</label>
          <input id="delayHours" name="delayHours" type="number" min="0" max="8760" className="field" defaultValue="24" />
        </div>
        <div>
          {kind === "TASK" ? (
            <>
              <label className="label" htmlFor="taskTitle">Task title</label>
              <input id="taskTitle" name="taskTitle" className="field" placeholder="Call the lead" />
            </>
          ) : (
            <>
              <label className="label" htmlFor="template">Approved template</label>
              <select id="template" name="template" className="field" defaultValue="">
                <option value="" disabled>Select…</option>
                {approved.map((t) => (
                  <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-muted">
        Wait is measured from the previous step (or enrolment, for the first step).
        {kind === "WHATSAPP_TEMPLATE" && approved.length === 0 && " No approved templates — sync them in Settings → WhatsApp first."}
      </p>
      <button type="submit" className="btn-ghost">+ Add step</button>
    </form>
  );
}
