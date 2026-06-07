"use client";

import { useActionState, useState } from "react";
import { recordPayment, type FormState } from "./actions";
import { humanize } from "@/lib/format";
import { Drawer } from "@/components/ui/Drawer";

const PAYMENT_TYPES = ["TOKEN", "BOOKING", "DOWN_PAYMENT", "INSTALMENT", "RENT", "DEPOSIT", "COMMISSION"];

interface PaymentFormProps {
  deals: { id: string; reference: string }[];
  /** Currently-open invoices (status ISSUED) — drives the optional invoice picker. */
  invoices?: { id: string; number: string; amount: string }[];
}

export function PaymentForm({ deals, invoices = [] }: PaymentFormProps) {
  const [open, setOpen] = useState(false);
  const [idemKey, setIdemKey] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const res = await recordPayment(p, fd);
    if (res.ok) setOpen(false);
    return res;
  }, {});

  // Fresh idempotency key per form opening. It rides along on every submit of
  // this form, so a double-click or a retried request maps to one payment —
  // the server's runOnce() replays instead of inserting a second row. A new
  // key is minted the next time the drawer opens (a genuinely new payment).
  function openForm() {
    setIdemKey(crypto.randomUUID());
    setOpen(true);
  }

  return (
    <div className="mb-4 flex justify-end">
      <button onClick={openForm} className="btn-accent">+ Record payment</button>

      <Drawer open={open} onClose={() => setOpen(false)} title="Record payment" width="md">
        <form action={action} className="space-y-3">
          <input type="hidden" name="idempotencyKey" value={idemKey} />
          {invoices.length > 0 && (
            <div>
              <label className="label" htmlFor="invoiceId">Apply to invoice (optional)</label>
              <select id="invoiceId" name="invoiceId" className="field" defaultValue="">
                <option value="">— None —</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.number} · {inv.amount}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                When set, the invoice auto-marks PAID once linked payments cover its amount.
              </p>
            </div>
          )}
          <div>
            <label className="label" htmlFor="dealId">Deal (optional)</label>
            <select id="dealId" name="dealId" className="field" defaultValue="">
              <option value="">— None —</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.reference}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="type">Type</label>
            <select id="type" name="type" className="field" defaultValue="INSTALMENT">
              {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="amount">Amount (PKR)</label><input id="amount" name="amount" type="number" min="0" className="field" required /></div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select id="status" name="status" className="field" defaultValue="PAID">
              <option value="PAID">Paid</option>
              <option value="PARTIAL">Partial</option>
              <option value="PENDING">Pending</option>
              <option value="OVERDUE">Overdue</option>
            </select>
          </div>
          <div><label className="label" htmlFor="dueDate">Due date</label><input id="dueDate" name="dueDate" type="date" className="field" /></div>
          <div><label className="label" htmlFor="receiptNo">Receipt no.</label><input id="receiptNo" name="receiptNo" className="field" /></div>
          {state.error && <p className="text-sm text-danger">{state.error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save payment"}</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
