"use client";

import { useActionState, useId, useMemo, useState } from "react";
import Link from "next/link";
import { createLead, type FormState } from "../actions";
import { humanize } from "@/lib/format";
import { PK_CITIES, suggestedAreas } from "@/lib/pk-areas";

const SOURCES = ["REFERRAL", "WALK_IN", "SOCIAL_MEDIA", "PORTAL", "CALL", "REPEAT_CLIENT", "OTHER"];

interface LeadFormProps {
  agents: { id: string; name: string }[];
  properties: { id: string; title: string; reference: string }[];
  canAssign: boolean;
}

function Err({ state, name }: { state: FormState; name: string }) {
  const msg = state.fieldErrors?.[name]?.[0];
  return msg ? <p className="mt-1 text-xs text-danger">{msg}</p> : null;
}

export function LeadForm({ agents, properties, canAssign }: LeadFormProps) {
  const [state, action, pending] = useActionState<FormState, FormData>(createLead, {});
  // City helper is local-state-only — it narrows the area datalist but isn't
  // submitted as a field (Lead has no prefCity column).
  const areaListId = useId();
  const [cityHint, setCityHint] = useState<string>("");
  const areas = useMemo(() => suggestedAreas(cityHint || null), [cityHint]);

  return (
    <form action={action} className="space-y-6">
      <div className="surface p-6">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink">Client</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="clientName">Name</label>
            <input id="clientName" name="clientName" className="field" required />
            <Err state={state} name="clientName" />
          </div>
          <div><label className="label" htmlFor="clientPhone">Phone</label><input id="clientPhone" name="clientPhone" className="field" /></div>
          <div><label className="label" htmlFor="clientEmail">Email</label><input id="clientEmail" name="clientEmail" type="email" className="field" /><Err state={state} name="clientEmail" /></div>
        </div>
      </div>

      <div className="surface p-6">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink">Enquiry</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="source">Source</label>
            <select id="source" name="source" className="field" defaultValue="REFERRAL">
              {SOURCES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
          </div>
          {canAssign && (
            <div>
              <label className="label" htmlFor="agentId">Assign to agent</label>
              <select id="agentId" name="agentId" className="field" defaultValue="">
                <option value="">— Unassigned —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="propertyId">Interested property (optional)</label>
            <select id="propertyId" name="propertyId" className="field" defaultValue="">
              <option value="">— None —</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.reference} · {p.title}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="budgetMin">Budget min (PKR)</label><input id="budgetMin" name="budgetMin" type="number" min="0" className="field" /></div>
          <div><label className="label" htmlFor="budgetMax">Budget max (PKR)</label><input id="budgetMax" name="budgetMax" type="number" min="0" className="field" /></div>
          <div>
            <label className="label" htmlFor="prefCityHint">Preferred city</label>
            <select
              id="prefCityHint"
              value={cityHint}
              onChange={(e) => setCityHint(e.target.value)}
              className="field"
            >
              <option value="">— Any —</option>
              {PK_CITIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="prefArea">Preferred area</label>
            <input
              id="prefArea"
              name="prefArea"
              list={areaListId}
              className="field"
              autoComplete="off"
              placeholder={cityHint ? `Areas in ${cityHint}` : "Type or pick a locality"}
            />
            <datalist id={areaListId}>
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
          <div className="sm:col-span-2"><label className="label" htmlFor="requirements">Requirements</label><textarea id="requirements" name="requirements" rows={3} className="field" /></div>
        </div>
      </div>

      {state.error && <p className="rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-accent">{pending ? "Saving…" : "Save lead"}</button>
        <Link href="/leads" className="btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}
