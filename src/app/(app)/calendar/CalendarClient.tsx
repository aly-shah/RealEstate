"use client";

import { useActionState, useState } from "react";
import { createEvent, setEventStatus, type FormState } from "./actions";
import { humanize, fmtDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/ui/Badge";

const TYPES = ["SHOWING", "MEETING", "FOLLOW_UP", "OPEN_HOUSE", "PAYMENT_REMINDER", "DOCUMENT_REMINDER", "RENTAL_RENEWAL", "DEAL_CLOSING"];

export interface CalEvent {
  id: string;
  title: string;
  type: string;
  status: string;
  startAt: string;
  agentName: string | null;
  propertyTitle: string | null;
}

interface CalendarClientProps {
  groups: { label: string; events: CalEvent[] }[];
  agents: { id: string; name: string }[];
  properties: { id: string; title: string; reference: string }[];
  canAssign: boolean;
}

export function CalendarClient({ groups, agents, properties, canAssign }: CalendarClientProps) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const res = await createEvent(p, fd);
    if (!res.error) setOpen(false);
    return res;
  }, {});

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setOpen((v) => !v)} className="btn-accent">{open ? "Close" : "+ New event"}</button>
      </div>

      {open && (
        <form action={action} className="surface mb-6 grid gap-4 p-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="title">Title</label>
            <input id="title" name="title" className="field" required />
            {state.fieldErrors?.title && <p className="mt-1 text-xs text-danger">{state.fieldErrors.title[0]}</p>}
          </div>
          <div>
            <label className="label" htmlFor="type">Type</label>
            <select id="type" name="type" className="field" defaultValue="SHOWING">
              {TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="startAt">Start</label>
            <input id="startAt" name="startAt" type="datetime-local" className="field" required />
          </div>
          {canAssign && (
            <div>
              <label className="label" htmlFor="agentId">Assign to</label>
              <select id="agentId" name="agentId" className="field" defaultValue="">
                <option value="">— Me —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="propertyId">Property (optional)</label>
            <select id="propertyId" name="propertyId" className="field" defaultValue="">
              <option value="">— None —</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.reference} · {p.title}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Add to calendar"}</button>
          </div>
        </form>
      )}

      {groups.length === 0 ? (
        <p className="surface p-8 text-center text-sm text-muted">No events scheduled.</p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.label}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-accent">{g.label}</h3>
              <ul className="space-y-2">
                {g.events.map((e) => (
                  <li key={e.id} className="surface flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{e.title}</p>
                      <p className="text-xs text-muted">
                        {fmtDateTime(e.startAt)}
                        {e.agentName ? ` · ${e.agentName}` : ""}
                        {e.propertyTitle ? ` · ${e.propertyTitle}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={e.type} />
                      {e.status !== "DONE" ? (
                        <form action={setEventStatus}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="status" value="DONE" />
                          <button type="submit" className="btn-ghost px-2 py-1 text-xs">✓ Done</button>
                        </form>
                      ) : (
                        <StatusBadge status="DONE" />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
