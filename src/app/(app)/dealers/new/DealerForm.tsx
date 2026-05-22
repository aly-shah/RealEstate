"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createDealer, type FormState } from "../actions";

function Err({ state, name }: { state: FormState; name: string }) {
  const msg = state.fieldErrors?.[name]?.[0];
  return msg ? <p className="mt-1 text-xs text-danger">{msg}</p> : null;
}

export function DealerForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createDealer, {});

  return (
    <form action={action} className="surface space-y-4 p-6">
      <div>
        <label className="label" htmlFor="name">Dealer name</label>
        <input id="name" name="name" className="field" required />
        <Err state={state} name="name" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="companyName">Company</label><input id="companyName" name="companyName" className="field" /></div>
        <div><label className="label" htmlFor="contact">Contact</label><input id="contact" name="contact" className="field" /></div>
        <div><label className="label" htmlFor="areaOfOperation">Area of operation</label><input id="areaOfOperation" name="areaOfOperation" className="field" /></div>
        <div><label className="label" htmlFor="defaultSharePct">Default share (%)</label><input id="defaultSharePct" name="defaultSharePct" type="number" min="0" max="100" step="0.5" className="field" defaultValue="0" /></div>
      </div>
      <div>
        <label className="label" htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" rows={3} className="field" />
      </div>

      {state.error && <p className="rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-accent">{pending ? "Saving…" : "Save dealer"}</button>
        <Link href="/dealers" className="btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}
