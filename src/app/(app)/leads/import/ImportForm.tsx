"use client";

import { useActionState } from "react";
import Link from "next/link";
import { importLeadsFromCsv, type FormState } from "./actions";

const PORTALS = ["ZAMEEN", "GRAANA", "OLX", "FACEBOOK", "CSV"] as const;

const SAMPLE_CSV = `name,phone,email,source,budgetMin,budgetMax,prefArea,requirements
Ahmed Khan,+92 300 1234567,ahmed@example.com,PORTAL,8000000,12000000,DHA Phase 5,3-bed apartment
Sara Malik,03021234567,,SOCIAL_MEDIA,,9000000,Bahria Town Karachi,Looking for ready-to-move`;

export function ImportForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    importLeadsFromCsv,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      <div className="surface space-y-4 p-6">
        <div>
          <label className="label" htmlFor="portal">Portal</label>
          <select id="portal" name="portal" className="field max-w-xs" defaultValue="ZAMEEN">
            {PORTALS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            Tagged on every imported lead as <code className="kbd">importSource</code>.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="file">Upload CSV file</label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="field cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
          />
          <p className="mt-1 text-xs text-muted">Up to 2 MB. Or paste the CSV text below — file wins if both are filled.</p>
        </div>

        <div>
          <label className="label" htmlFor="csv">…or paste CSV text</label>
          <textarea
            id="csv"
            name="csv"
            rows={10}
            className="field font-mono text-xs"
            placeholder={SAMPLE_CSV}
            spellCheck={false}
          />
        </div>
      </div>

      {state.error && (
        <p className="rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      {state.result && (
        <div className="surface space-y-3 p-5">
          <h3 className="text-sm font-semibold text-ink">Import summary</h3>
          <ul className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <li className="rounded-lg border border-line bg-paper p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Rows</p>
              <p className="text-lg font-semibold text-ink">{state.result.total}</p>
            </li>
            <li className="rounded-lg border border-line bg-paper p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Created</p>
              <p className="text-lg font-semibold text-ok">{state.result.created}</p>
            </li>
            <li className="rounded-lg border border-line bg-paper p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Reused client</p>
              <p className="text-lg font-semibold text-accent">{state.result.reused}</p>
            </li>
            <li className="rounded-lg border border-line bg-paper p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Errors</p>
              <p className="text-lg font-semibold text-danger">{state.result.errors.length}</p>
            </li>
          </ul>

          {state.result.errors.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-slate hover:text-ink">
                Show row errors
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                {state.result.errors.map((e, i) => (
                  <li key={i} className="rounded-md border border-line-soft bg-line-soft/50 px-2 py-1">
                    <span className="font-medium text-ink">Row {e.row}:</span>{" "}
                    <span className="text-slate">{e.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {state.result.created > 0 && (
            <Link href="/leads" className="btn-accent w-full text-center sm:w-auto">
              View imported leads →
            </Link>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Importing…" : "Import"}
        </button>
        <Link href="/leads" className="btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}
