"use client";

import { useActionState, useState } from "react";
import { createSequence, addStep, type FormState } from "./actions";
import { humanize } from "@/lib/format";
import { humanizeHours } from "./_lib";

const TRIGGER_STAGES = [
  "NEW", "CONTACTED", "INTERESTED", "SITE_VISIT", "PROPERTY_SHOWN", "NEGOTIATION", "TOKEN_BOOKING", "PAYMENT",
];

const DELAY_PRESETS = [
  { label: "Now", h: 0 },
  { label: "1 hour", h: 1 },
  { label: "1 day", h: 24 },
  { label: "3 days", h: 72 },
  { label: "1 week", h: 168 },
];

type Kind = "TASK" | "WHATSAPP_TEMPLATE";

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
        <label className="label" htmlFor="triggerStage">Enrols when lead reaches</label>
        <select id="triggerStage" name="triggerStage" className="field" defaultValue="NEW">
          <option value="">Manual only</option>
          {TRIGGER_STAGES.map((s) => (
            <option key={s} value={s}>{humanize(s)}</option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className="btn-accent">{pending ? "Creating…" : "Create sequence"}</button>
      {state.error && <p className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}

/** Add-a-step form — segmented type toggle, delay presets, and a live cadence preview. */
export function StepForm({
  sequenceId,
  approved,
}: {
  sequenceId: string;
  approved: { name: string; language: string }[];
}) {
  const [kind, setKind] = useState<Kind>("TASK");
  const [delay, setDelay] = useState(24);
  const noTemplates = kind === "WHATSAPP_TEMPLATE" && approved.length === 0;

  return (
    <form action={addStep} className="space-y-4 rounded-2xl border border-dashed border-line bg-canvas/40 p-4">
      <input type="hidden" name="sequenceId" value={sequenceId} />
      <input type="hidden" name="kind" value={kind} />
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate">Add a step</p>

      {/* Step type — segmented control */}
      <div className="inline-flex rounded-xl border border-line bg-paper p-1">
        {([["TASK", "Agent task"], ["WHATSAPP_TEMPLATE", "WhatsApp message"]] as const).map(([val, label]) => (
          <button
            type="button"
            key={val}
            onClick={() => setKind(val)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              kind === val ? "bg-ink text-white shadow-sm" : "text-slate hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Delay — number + one-tap presets */}
      <div>
        <label className="label" htmlFor="delayHours">Wait before this step</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="delayHours"
            name="delayHours"
            type="number"
            min="0"
            max="8760"
            value={delay}
            onChange={(e) => setDelay(Math.max(0, Number(e.target.value) || 0))}
            className="field w-24"
          />
          <span className="text-xs text-muted">hours</span>
          <div className="flex flex-wrap gap-1">
            {DELAY_PRESETS.map((p) => (
              <button
                type="button"
                key={p.h}
                onClick={() => setDelay(p.h)}
                className={`chip ${
                  delay === p.h
                    ? "border-accent/30 bg-accent-wash text-accent"
                    : "border-line bg-line-soft text-slate hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Type-specific field */}
      {kind === "TASK" ? (
        <div>
          <label className="label" htmlFor="taskTitle">Task for the agent</label>
          <input id="taskTitle" name="taskTitle" className="field" placeholder="e.g. Call the lead to check in" />
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="template">Approved WhatsApp template</label>
          <select id="template" name="template" className="field" defaultValue="" disabled={noTemplates}>
            <option value="" disabled>Select a template…</option>
            {approved.map((t) => (
              <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                {t.name} ({t.language})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Live cadence preview */}
      <p className="rounded-lg bg-line-soft px-3 py-2 text-xs text-slate">
        {delay <= 0 ? "Runs immediately" : `Runs ${humanizeHours(delay)}`} after the previous step
        {" "}(or enrolment, if it&rsquo;s the first step).
        {kind === "WHATSAPP_TEMPLATE" && !noTemplates && " The template’s {{1}} is filled with the client’s name."}
        {noTemplates && " — no approved templates yet; sync them in Settings → WhatsApp first."}
      </p>

      <button type="submit" disabled={noTemplates} className="btn-accent">+ Add step</button>
    </form>
  );
}
