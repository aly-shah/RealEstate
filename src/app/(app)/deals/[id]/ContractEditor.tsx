"use client";

import { useActionState, useState } from "react";
import { updateContract } from "@/app/(app)/deals/actions";
import { Drawer } from "@/components/ui/Drawer";

export interface ContractEditorValues {
  salePrice?: number | null;
  tokenAmount?: number | null;
  downPayment?: number | null;
  monthlyRent?: number | null;
  deposit?: number | null;
  leaseMonths?: number | null;
  startDate?: string | null; // yyyy-mm-dd
  endDate?: string | null;
  possessionDate?: string | null;
  landlordCnicName?: string | null;
  landlordCnic?: string | null;
  renterCnicName?: string | null;
  renterCnic?: string | null;
  customClauses?: string | null;
}

const num = (n?: number | null) => (n == null ? "" : String(n));
const str = (s?: string | null) => s ?? "";

/** Operator-facing editor for a single deal's contract — terms, parties and
 *  special clauses. Pre-filled so saving preserves the OCR-captured identity. */
export function ContractEditor({
  dealId,
  isSale,
  values,
}: {
  dealId: string;
  isSale: boolean;
  values: ContractEditorValues;
}) {
  const [open, setOpen] = useState(false);
  const [, action, pending] = useActionState(async (_prev: null, fd: FormData) => {
    await updateContract(fd);
    setOpen(false);
    return null;
  }, null);

  const partyA = isSale ? "Seller" : "Landlord";
  const partyB = isSale ? "Buyer" : "Tenant";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost w-full justify-center text-xs">
        Edit contract
      </button>

      <Drawer open={open} onClose={() => setOpen(false)} title="Edit contract" width="md">
        <form action={action} className="space-y-4">
          <input type="hidden" name="dealId" value={dealId} />

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate">Terms</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {isSale ? (
                <>
                  <Field label="Sale price (PKR)" name="salePrice" type="number" defaultValue={num(values.salePrice)} />
                  <Field label="Token / bayana (PKR)" name="tokenAmount" type="number" defaultValue={num(values.tokenAmount)} />
                  <Field label="Down payment (PKR)" name="downPayment" type="number" defaultValue={num(values.downPayment)} />
                  <Field label="Possession date" name="possessionDate" type="date" defaultValue={str(values.possessionDate)} />
                </>
              ) : (
                <>
                  <Field label="Monthly rent (PKR)" name="monthlyRent" type="number" defaultValue={num(values.monthlyRent)} />
                  <Field label="Security deposit (PKR)" name="deposit" type="number" defaultValue={num(values.deposit)} />
                  <Field label="Lease term (months)" name="leaseMonths" type="number" defaultValue={num(values.leaseMonths)} />
                  <Field label="Start date" name="startDate" type="date" defaultValue={str(values.startDate)} />
                  <Field label="End date" name="endDate" type="date" defaultValue={str(values.endDate)} />
                  <Field label="Possession date" name="possessionDate" type="date" defaultValue={str(values.possessionDate)} />
                </>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate">Parties</p>
            <p className="mb-2 text-xs text-muted">Auto-filled from CNIC verification — override only if needed.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`${partyA} name`} name="landlordCnicName" defaultValue={str(values.landlordCnicName)} />
              <Field label={`${partyA} CNIC`} name="landlordCnic" defaultValue={str(values.landlordCnic)} />
              <Field label={`${partyB} name`} name="renterCnicName" defaultValue={str(values.renterCnicName)} />
              <Field label={`${partyB} CNIC`} name="renterCnic" defaultValue={str(values.renterCnic)} />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="customClauses">Special clauses</label>
            <textarea
              id="customClauses"
              name="customClauses"
              rows={4}
              className="field"
              placeholder="Any additional terms agreed between the parties…"
              defaultValue={str(values.customClauses)}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save contract"}</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
          </div>
        </form>
      </Drawer>
    </>
  );
}

function Field({
  label, name, type = "text", defaultValue,
}: {
  label: string; name: string; type?: string; defaultValue: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} className="field" defaultValue={defaultValue} {...(type === "number" ? { min: "0", step: "any" } : {})} />
    </div>
  );
}
