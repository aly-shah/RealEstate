"use client";

import { useActionState, useState } from "react";
import { createProject, type FormState } from "./actions";
import { Drawer } from "@/components/ui/Drawer";

/** Office-only "New project" drawer. createProject redirects to the new project on success. */
export function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(createProject, {});

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-accent">+ New project</button>
      <Drawer open={open} onClose={() => setOpen(false)} title="New project" description="A development whose units you'll generate." width="md">
        <form action={action} className="space-y-3">
          {state.error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{state.error}</p>}
          <div>
            <label className="label" htmlFor="name">Project name</label>
            <input id="name" name="name" className="field" placeholder="e.g. Skyline Towers" required />
            {state.fieldErrors?.name && <p className="mt-1 text-xs text-danger">{state.fieldErrors.name[0]}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="city">City</label><input id="city" name="city" className="field" placeholder="Karachi" /></div>
            <div><label className="label" htmlFor="area">Area</label><input id="area" name="area" className="field" placeholder="DHA Phase 8" /></div>
          </div>
          <div>
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" name="description" rows={2} className="field" placeholder="Optional overview shown to dealers/buyers." />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="isOffPlan" value="true" className="h-4 w-4 rounded border-line" />
            Off-plan (under construction)
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={pending} className="btn-accent">{pending ? "Creating…" : "Create project"}</button>
          </div>
        </form>
      </Drawer>
    </>
  );
}
