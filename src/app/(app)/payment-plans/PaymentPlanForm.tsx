"use client";

import { useActionState, useState } from "react";
import { createPaymentPlan, type FormState } from "./actions";
import { Drawer } from "@/components/ui/Drawer";
import { totalPct } from "@/lib/payment-plan";

const TYPES = ["BOOKING", "DOWN_PAYMENT", "INSTALMENT", "TOKEN", "DEPOSIT"];

interface Row { label: string; pct: number; type: string; count: number; firstDueMonths: number; intervalMonths: number }

const DEFAULT_ROWS: Row[] = [
  { label: "Booking", pct: 10, type: "BOOKING", count: 1, firstDueMonths: 0, intervalMonths: 1 },
  { label: "Confirmation", pct: 10, type: "DOWN_PAYMENT", count: 1, firstDueMonths: 1, intervalMonths: 1 },
  { label: "Installments", pct: 80, type: "INSTALMENT", count: 36, firstDueMonths: 2, intervalMonths: 1 },
];

export function PaymentPlanForm() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(DEFAULT_ROWS);
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const r = await createPaymentPlan(p, fd);
    if (r.ok) { setOpen(false); setRows(DEFAULT_ROWS); }
    return r;
  }, {});

  const sum = totalPct(rows);
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-accent">+ New plan</button>
      <Drawer open={open} onClose={() => setOpen(false)} title="New payment plan" description="Milestones as % of the sale price." width="xl">
        <form action={action} className="space-y-4">
          {state.error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{state.error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="pp-name">Plan name</label><input id="pp-name" name="name" className="field" placeholder="Standard 3-year" required /></div>
            <div><label className="label" htmlFor="pp-desc">Description</label><input id="pp-desc" name="description" className="field" placeholder="Optional" /></div>
          </div>

          <div className="space-y-2">
            <div className="hidden gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted sm:grid sm:grid-cols-[1.4fr_0.7fr_1fr_0.7fr_0.8fr_0.8fr_auto]">
              <span>Label</span><span>%</span><span>Type</span><span>Count</span><span>First (mo)</span><span>Every (mo)</span><span />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1.4fr_0.7fr_1fr_0.7fr_0.8fr_0.8fr_auto] sm:border-0 sm:p-0">
                <input name="label" value={r.label} onChange={(e) => set(i, { label: e.target.value })} className="field" placeholder="Label" />
                <input name="pct" type="number" min="0" step="any" value={r.pct} onChange={(e) => set(i, { pct: Number(e.target.value) })} className="field" />
                <select name="type" value={r.type} onChange={(e) => set(i, { type: e.target.value })} className="field">
                  {TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </select>
                <input name="count" type="number" min="1" value={r.count} onChange={(e) => set(i, { count: Number(e.target.value) })} className="field" />
                <input name="firstDueMonths" type="number" min="0" value={r.firstDueMonths} onChange={(e) => set(i, { firstDueMonths: Number(e.target.value) })} className="field" />
                <input name="intervalMonths" type="number" min="0" value={r.intervalMonths} onChange={(e) => set(i, { intervalMonths: Number(e.target.value) })} className="field" />
                <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="btn-ghost !px-2 text-danger" aria-label="Remove">✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setRows((rs) => [...rs, { label: "", pct: 0, type: "INSTALMENT", count: 1, firstDueMonths: 0, intervalMonths: 1 }])} className="btn-ghost text-xs">+ Add milestone</button>
          </div>

          <p className={`text-xs ${sum === 100 ? "text-ok" : "text-warn"}`}>Total: {sum}%{sum !== 100 ? " — most plans sum to 100%." : " ✓"}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={pending} className="btn-accent">{pending ? "Saving…" : "Create plan"}</button>
          </div>
        </form>
      </Drawer>
    </>
  );
}
