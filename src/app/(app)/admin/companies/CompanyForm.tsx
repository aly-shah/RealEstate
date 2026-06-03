"use client";

import { useActionState, useState } from "react";
import { createCompany, type FormState } from "./actions";

const PLANS = ["FREE", "TRIAL", "STARTER", "GROWTH", "PRO"] as const;

/** Cheap client-side slug suggester so the operator sees what the server will store. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Mirror of lib/refs.ts:derivePrefix for the placeholder preview only. */
function derivePrefixPreview(name: string): string {
  const words = name.split(/\s+/).map((w) => w.replace(/[^a-zA-Z]/g, "")).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return (words[0].slice(0, 3) || "").toUpperCase();
  return words.map((w) => w[0]).join("").slice(0, 4).toUpperCase();
}

export function CompanyForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createCompany, {});
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<(typeof PLANS)[number]>("STARTER");

  const slugSuggestion = name ? slugify(name) : "";
  const prefixSuggestion = name ? derivePrefixPreview(name) : "";

  return (
    <form action={action} className="space-y-4" key={state.ok ? "reset" : "form"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="companyName">Company name</label>
          <input
            id="companyName"
            name="companyName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="slug">URL slug</label>
          <input
            id="slug"
            name="slug"
            className="field"
            placeholder={slugSuggestion || "auto-derived"}
            pattern="[a-z0-9-]+"
            maxLength={40}
          />
          <p className="mt-1 text-xs text-muted">Reserved for white-label routing. Leave empty to auto-derive.</p>
        </div>
        <div>
          <label className="label" htmlFor="refPrefix">Reference prefix</label>
          <input
            id="refPrefix"
            name="refPrefix"
            className="field"
            placeholder={prefixSuggestion || "auto-derived"}
            pattern="[A-Z0-9]{2,6}"
            maxLength={6}
          />
          <p className="mt-1 text-xs text-muted">
            Stem for property + deal + invoice numbers (e.g. {prefixSuggestion || "PROP"}-0001).
          </p>
        </div>
        <div>
          <label className="label" htmlFor="plan">Plan</label>
          <select
            id="plan"
            name="plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as (typeof PLANS)[number])}
            className="field"
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="trialEndsAt">Trial ends</label>
          <input
            id="trialEndsAt"
            name="trialEndsAt"
            type="date"
            className="field"
            disabled={plan !== "TRIAL"}
          />
          <p className="mt-1 text-xs text-muted">Auto-set to +30 days when TRIAL; ignored otherwise.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="timezone">Timezone (IANA)</label>
          <input
            id="timezone"
            name="timezone"
            className="field"
            placeholder="Asia/Karachi"
            maxLength={60}
          />
        </div>

        <hr className="sm:col-span-2 border-line-soft" />

        <div><label className="label" htmlFor="ownerName">Owner name</label><input id="ownerName" name="ownerName" className="field" required /></div>
        <div><label className="label" htmlFor="ownerEmail">Owner email</label><input id="ownerEmail" name="ownerEmail" type="email" className="field" required /></div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="ownerPassword">Owner password</label>
          <input id="ownerPassword" name="ownerPassword" type="text" className="field" required minLength={6} />
          <p className="mt-1 text-xs text-muted">Plain text on purpose so the operator can hand it over. Owner should change it on first login.</p>
        </div>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">Company created.</p>}

      <button type="submit" disabled={pending} className="btn-accent">
        {pending ? "Creating…" : "Create company"}
      </button>
    </form>
  );
}
