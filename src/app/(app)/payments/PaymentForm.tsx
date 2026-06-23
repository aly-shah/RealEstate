"use client";

import { useActionState, useState, useTransition } from "react";
import { recordPayment, dealOutstanding, payScheduled, type FormState, type OutstandingItem } from "./actions";
import { humanize, money } from "@/lib/format";
import { Drawer } from "@/components/ui/Drawer";

const PAYMENT_TYPES = ["TOKEN", "BOOKING", "DOWN_PAYMENT", "INSTALMENT", "RENT", "DEPOSIT", "COMMISSION"];
const METHODS = ["Bank transfer", "Cash", "Cheque", "Online", "Card"];

interface PaymentFormProps {
  deals: { id: string; reference: string }[];
  invoices?: { id: string; number: string; amount: string }[];
}

const tab = (on: boolean) =>
  `rounded-lg px-3 py-1.5 font-medium transition ${on ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"}`;

export function PaymentForm({ deals, invoices = [] }: PaymentFormProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"installments" | "other">("installments");

  // ── Installments mode ──────────────────────────────────────────────────────
  const [dealId, setDealId] = useState("");
  const [items, setItems] = useState<OutstandingItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState("Bank transfer");
  const [paidAt, setPaidAt] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [payErr, setPayErr] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [paying, startPay] = useTransition();

  // ── Other (ad-hoc) mode — existing recordPayment form ──────────────────────
  const [idemKey, setIdemKey] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const res = await recordPayment(p, fd);
    if (res.ok) setOpen(false);
    return res;
  }, {});

  function openForm() {
    setIdemKey(crypto.randomUUID());
    setMode("installments");
    setDealId(""); setItems([]); setSelected(new Set()); setPayErr(null); setReceiptNo("");
    setOpen(true);
  }

  function loadDeal(id: string) {
    setDealId(id); setSelected(new Set()); setItems([]); setPayErr(null);
    if (!id) return;
    startLoad(async () => setItems(await dealOutstanding(id)));
  }
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSel = items.length > 0 && items.every((i) => selected.has(i.id));
  const overdueIds = items.filter((i) => i.dueDate && new Date(i.dueDate) < new Date()).map((i) => i.id);
  const selTotal = items.filter((i) => selected.has(i.id)).reduce((a, i) => a + i.amount, 0);

  function submitInstallments() {
    if (selected.size === 0) { setPayErr("Select at least one installment to record."); return; }
    setPayErr(null);
    startPay(async () => {
      const r = await payScheduled({ paymentIds: [...selected], paidAt: paidAt || undefined, method, receiptNo: receiptNo || undefined });
      if (!r.ok) { setPayErr(r.error || "Couldn't record the payment."); return; }
      setOpen(false);
    });
  }

  return (
    <div className="mb-4 flex justify-end">
      <button onClick={openForm} className="btn-accent">+ Record payment</button>

      <Drawer open={open} onClose={() => setOpen(false)} title="Record payment" description={mode === "installments" ? "Apply against a deal's installment schedule" : "A one-off payment"} width="lg">
        <div className="mb-4 inline-flex rounded-xl border border-line bg-canvas/40 p-0.5 text-sm">
          <button type="button" onClick={() => setMode("installments")} className={tab(mode === "installments")}>Pay installments</button>
          <button type="button" onClick={() => setMode("other")} className={tab(mode === "other")}>Other payment</button>
        </div>

        {mode === "installments" ? (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="i-deal">Deal</label>
              <select id="i-deal" className="field text-ink" value={dealId} onChange={(e) => loadDeal(e.target.value)}>
                <option value="">— Pick a deal —</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.reference}</option>)}
              </select>
            </div>

            {dealId && (loading ? (
              <p className="text-sm text-muted">Loading schedule…</p>
            ) : items.length === 0 ? (
              <p className="rounded-lg border border-line bg-canvas/50 px-3 py-2 text-sm text-muted">No outstanding installments for this deal.</p>
            ) : (
              <>
                <div className="overflow-hidden rounded-xl border border-line">
                  <div className="flex items-center justify-between border-b border-line bg-canvas/40 px-3 py-2 text-xs">
                    <label className="flex items-center gap-2 font-medium text-ink">
                      <input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(items.map((i) => i.id)))} />
                      Select all ({items.length})
                    </label>
                    {overdueIds.length > 0 && (
                      <button type="button" onClick={() => setSelected(new Set(overdueIds))} className="font-medium text-danger">Select {overdueIds.length} overdue</button>
                    )}
                  </div>
                  <ul className="max-h-64 divide-y divide-line-soft overflow-auto">
                    {items.map((i) => {
                      const overdue = i.dueDate ? new Date(i.dueDate) < new Date() : false;
                      return (
                        <li key={i.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                          <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                          <span className="flex-1 truncate text-ink">{i.label}</span>
                          {i.dueDate && <span className={`shrink-0 text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}>{overdue ? "overdue " : "due "}{i.dueDate.slice(0, 10)}</span>}
                          <span className="shrink-0 font-medium text-ink">{money(i.amount)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div><label className="label" htmlFor="i-date">Paid date</label><input id="i-date" type="date" className="field text-ink" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /><p className="mt-0.5 text-[10px] text-muted">defaults to today</p></div>
                  <div><label className="label" htmlFor="i-method">Method</label><select id="i-method" className="field text-ink" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
                  <div><label className="label" htmlFor="i-rcpt">Receipt no.</label><input id="i-rcpt" className="field text-ink" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="optional" /></div>
                </div>

                {payErr && <p className="text-sm text-danger">{payErr}</p>}
                <div className="flex items-center justify-between border-t border-line pt-3">
                  <span className="text-sm font-medium text-ink">{selected.size} selected · {money(selTotal)}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
                    <button type="button" onClick={submitInstallments} disabled={paying || selected.size === 0} className="btn-accent">{paying ? "Recording…" : `Record payment${selected.size > 1 ? "s" : ""}`}</button>
                  </div>
                </div>
              </>
            ))}
            {!dealId && <p className="text-xs text-muted">Pick a deal to load its installment schedule, then tick the payments received.</p>}
          </div>
        ) : (
          <form action={action} className="space-y-3">
            <input type="hidden" name="idempotencyKey" value={idemKey} />
            {invoices.length > 0 && (
              <div>
                <label className="label" htmlFor="invoiceId">Apply to invoice (optional)</label>
                <select id="invoiceId" name="invoiceId" className="field text-ink" defaultValue="">
                  <option value="">— None —</option>
                  {invoices.map((inv) => <option key={inv.id} value={inv.id}>{inv.number} · {inv.amount}</option>)}
                </select>
                <p className="mt-1 text-xs text-muted">When set, the invoice auto-marks PAID once linked payments cover its amount.</p>
              </div>
            )}
            <div>
              <label className="label" htmlFor="dealId">Deal (optional)</label>
              <select id="dealId" name="dealId" className="field text-ink" defaultValue="">
                <option value="">— None —</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.reference}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="type">Type</label>
                <select id="type" name="type" className="field text-ink" defaultValue="INSTALMENT">{PAYMENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
              </div>
              <div><label className="label" htmlFor="amount">Amount (PKR)</label><input id="amount" name="amount" type="number" min="0" className="field text-ink" required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="status">Status</label>
                <select id="status" name="status" className="field text-ink" defaultValue="PAID">
                  <option value="PAID">Paid</option>
                  <option value="PARTIAL">Partial</option>
                  <option value="PENDING">Pending</option>
                  <option value="OVERDUE">Overdue</option>
                </select>
              </div>
              <div><label className="label" htmlFor="dueDate">Due date</label><input id="dueDate" name="dueDate" type="date" className="field text-ink" /></div>
            </div>
            <div><label className="label" htmlFor="receiptNo">Receipt no.</label><input id="receiptNo" name="receiptNo" className="field text-ink" /></div>
            {state.error && <p className="text-sm text-danger">{state.error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={pending} className="btn-accent">{pending ? "Saving…" : "Save payment"}</button>
            </div>
          </form>
        )}
      </Drawer>
    </div>
  );
}
