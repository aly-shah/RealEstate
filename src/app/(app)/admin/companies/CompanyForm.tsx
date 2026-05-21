"use client";

import { useActionState } from "react";
import { createCompany, type FormState } from "./actions";

export function CompanyForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createCompany, {});

  return (
    <form action={action} className="space-y-4" key={state.ok ? "reset" : "form"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label" htmlFor="companyName">Company name</label><input id="companyName" name="companyName" className="field" required /></div>
        <div><label className="label" htmlFor="ownerName">Owner name</label><input id="ownerName" name="ownerName" className="field" required /></div>
        <div><label className="label" htmlFor="ownerEmail">Owner email</label><input id="ownerEmail" name="ownerEmail" type="email" className="field" required /></div>
        <div><label className="label" htmlFor="ownerPassword">Owner password</label><input id="ownerPassword" name="ownerPassword" type="text" className="field" required minLength={6} /></div>
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">Company created.</p>}
      <button type="submit" disabled={pending} className="btn-accent">{pending ? "Creating…" : "Create company"}</button>
    </form>
  );
}
