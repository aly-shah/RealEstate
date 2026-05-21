"use client";

import { useActionState } from "react";
import { createUser, updateCommissionRule, type FormState } from "./actions";

interface RuleDefaults {
  mainAgentPct: number;
  companyPct: number;
  otherAgentPct: number;
  dealerPct: number;
  noOtherFallback: string;
}

export function CommissionRuleForm({ defaults }: { defaults: RuleDefaults }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateCommissionRule, {});

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><label className="label" htmlFor="mainAgentPct">Main agent %</label><input id="mainAgentPct" name="mainAgentPct" type="number" min="0" max="100" step="0.5" defaultValue={defaults.mainAgentPct} className="field" /></div>
        <div><label className="label" htmlFor="companyPct">Company %</label><input id="companyPct" name="companyPct" type="number" min="0" max="100" step="0.5" defaultValue={defaults.companyPct} className="field" /></div>
        <div><label className="label" htmlFor="otherAgentPct">Co-agents %</label><input id="otherAgentPct" name="otherAgentPct" type="number" min="0" max="100" step="0.5" defaultValue={defaults.otherAgentPct} className="field" /></div>
        <div><label className="label" htmlFor="dealerPct">Dealer %</label><input id="dealerPct" name="dealerPct" type="number" min="0" max="100" step="0.5" defaultValue={defaults.dealerPct} className="field" /></div>
      </div>
      <div>
        <label className="label" htmlFor="noOtherFallback">If there are no co-agents, their share goes to</label>
        <select id="noOtherFallback" name="noOtherFallback" className="field max-w-xs" defaultValue={defaults.noOtherFallback}>
          <option value="MAIN">The main agent</option>
          <option value="COMPANY">The company</option>
        </select>
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">Saved.</p>}
      <button type="submit" disabled={pending} className="btn-accent">{pending ? "Saving…" : "Save split rule"}</button>
    </form>
  );
}

export function NewUserForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const res = await createUser(p, fd);
    return res;
  }, {});

  return (
    <form action={action} className="space-y-4" key={state.ok ? "reset" : "form"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" className="field" required /></div>
        <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="field" required /></div>
        <div><label className="label" htmlFor="password">Temporary password</label><input id="password" name="password" type="text" className="field" required minLength={6} /></div>
        <div><label className="label" htmlFor="phone">Phone</label><input id="phone" name="phone" className="field" /></div>
        <div>
          <label className="label" htmlFor="role">Role</label>
          <select id="role" name="role" className="field" defaultValue="AGENT">
            <option value="AGENT">Agent</option>
            <option value="ADMIN">Admin</option>
            <option value="DEALER">Dealer</option>
          </select>
        </div>
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">User created.</p>}
      <button type="submit" disabled={pending} className="btn-primary">{pending ? "Creating…" : "Add user"}</button>
    </form>
  );
}
