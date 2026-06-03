"use client";

import { useActionState, useState } from "react";
import { humanize } from "@/lib/format";
import { setDealStatus, generateCommission } from "@/app/(app)/deals/actions";
import { recordPayment, type FormState } from "@/app/(app)/payments/actions";
import {
  createInvoice,
  type FormState as InvoiceFormState,
} from "@/app/(app)/invoices/actions";

const DEAL_STATUSES = ["DRAFT", "NEGOTIATION", "TOKEN", "BOOKED", "AGREEMENT", "CLOSED_WON", "CLOSED_LOST"];
const PAYMENT_TYPES = ["TOKEN", "BOOKING", "DOWN_PAYMENT", "INSTALMENT", "RENT", "DEPOSIT", "COMMISSION"];

export function DealStatusChanger({ id, current }: { id: string; current: string }) {
  const [status, setStatus] = useState(current);
  const isLost = status === "CLOSED_LOST";

  return (
    <form action={setDealStatus} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <select
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="field"
        >
          {DEAL_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        <button type="submit" className="btn-ghost px-3 py-2 text-xs">Update</button>
      </div>
      {isLost && (
        <div>
          <label className="label" htmlFor={`deal-lost-${id}`}>Reason for loss</label>
          <input
            id={`deal-lost-${id}`}
            name="lostReason"
            className="field"
            required
            placeholder="Why was this deal lost?"
          />
        </div>
      )}
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

/**
 * Inline "Create invoice" form, scoped to a single deal. Prefills the amount
 * with the deal's headline value (sale price or monthly rent) so the common
 * "bill the full amount" case is one click. Office-only — the parent only
 * renders this for users with `managePayments`.
 */
export function CreateInvoiceForm({
  dealId,
  suggestedAmount,
}: {
  dealId: string;
  suggestedAmount: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(
    createInvoice,
    {},
  );

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost w-full text-sm">
        + Create invoice
      </button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line p-3">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="redirectTo" value={`/deals/${dealId}`} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={`inv-amount-${dealId}`}>Amount (PKR)</label>
          <input
            id={`inv-amount-${dealId}`}
            name="amount"
            type="number"
            min="0"
            step="1"
            defaultValue={suggestedAmount > 0 ? suggestedAmount : ""}
            className="field"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor={`inv-due-${dealId}`}>Due date</label>
          <input id={`inv-due-${dealId}`} name="dueDate" type="date" className="field" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`inv-desc-${dealId}`}>Description (optional)</label>
        <input
          id={`inv-desc-${dealId}`}
          name="description"
          className="field"
          placeholder="e.g. Booking instalment 2 of 4"
          maxLength={500}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-slate">
        <input type="checkbox" name="asDraft" value="true" className="accent-ink" />
        Save as draft (don&apos;t issue yet)
      </label>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5 text-xs">
          {pending ? "Saving…" : "Issue invoice"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
