"use client";

import { useActionState, useState } from "react";
import { humanize } from "@/lib/format";
import { setDealStatus, generateCommission } from "@/app/(app)/deals/actions";
import { recordPayment, type FormState } from "@/app/(app)/payments/actions";

const DEAL_STATUSES = ["DRAFT", "NEGOTIATION", "TOKEN", "BOOKED", "AGREEMENT", "CLOSED_WON", "CLOSED_LOST"];
const PAYMENT_TYPES = ["TOKEN", "BOOKING", "DOWN_PAYMENT", "INSTALMENT", "RENT", "DEPOSIT", "COMMISSION"];

export function DealStatusChanger({ id, current }: { id: string; current: string }) {
  return (
    <form action={setDealStatus} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <select name="status" defaultValue={current} className="field">
        {DEAL_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
      </select>
      <button type="submit" className="btn-ghost px-3 py-2 text-xs">Update</button>
    </form>
  );
}

export function GenerateCommissionForm({ dealId, suggested }: { dealId: string; suggested: number }) {
  return (
    <form action={generateCommission} className="space-y-3">
      <input type="hidden" name="dealId" value={dealId} />
      <div>
        <label className="label" htmlFor="total">Total commission (PKR)</label>
        <input id="total" name="total" type="number" min="0" defaultValue={suggested || ""} className="field" required />
      </div>
      <button type="submit" className="btn-accent w-full">Calculate split</button>
      <p className="text-xs text-muted">Splits across main agent, company, co-agents and dealer per the property&apos;s rule.</p>
    </form>
  );
}

export function RecordPaymentForm({ dealId, isRental }: { dealId: string; isRental: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const res = await recordPayment(p, fd);
    if (res.ok) setOpen(false);
    return res;
  }, {});

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-ghost w-full text-sm">+ Record payment</button>;
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line p-3">
      <input type="hidden" name="dealId" value={dealId} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="type">Type</label>
          <select id="type" name="type" className="field" defaultValue={isRental ? "RENT" : "INSTALMENT"}>
            {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" className="field" defaultValue="PAID">
            <option value="PAID">Paid</option>
            <option value="PENDING">Pending</option>
            <option value="PARTIAL">Partial</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="amount">Amount</label><input id="amount" name="amount" type="number" min="0" className="field" required /></div>
        <div><label className="label" htmlFor="dueDate">Due date</label><input id="dueDate" name="dueDate" type="date" className="field" /></div>
      </div>
      <input name="receiptNo" className="field" placeholder="Receipt no. (optional)" />
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5 text-xs">{pending ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost px-3 py-1.5 text-xs">Cancel</button>
      </div>
    </form>
  );
}
