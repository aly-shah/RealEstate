"use client";

import { useActionState, useState } from "react";
import { uploadDocument, type FormState } from "./actions";
import { humanize } from "@/lib/format";
import { Uploader } from "@/components/ui/Uploader";
import { Drawer } from "@/components/ui/Drawer";

const TYPES = ["CNIC_PASSPORT", "PROPERTY_DOCUMENT", "OWNERSHIP_DOCUMENT", "SALE_AGREEMENT", "RENTAL_AGREEMENT", "PAYMENT_RECEIPT", "DEALER_DOCUMENT", "CLIENT_DOCUMENT", "OTHER"];

interface DocumentFormProps {
  properties: { id: string; title: string; reference: string }[];
}

export function DocumentForm({ properties }: DocumentFormProps) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const res = await uploadDocument(p, fd);
    if (res.ok) setOpen(false);
    return res;
  }, {});

  return (
    <div className="mb-4 flex justify-end">
      <button onClick={() => setOpen(true)} className="btn-accent">+ Add document</button>

      <Drawer open={open} onClose={() => setOpen(false)} title="Add document" width="md">
        <form action={action} className="space-y-3">
          <div>
            <label className="label" htmlFor="name">Document name</label>
            <input id="name" name="name" className="field" required />
          </div>
          <div>
            <label className="label" htmlFor="type">Type</label>
            <select id="type" name="type" className="field" defaultValue="PROPERTY_DOCUMENT">
              {TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="expiryDate">Expiry date (optional)</label>
            <input id="expiryDate" name="expiryDate" type="date" className="field" />
          </div>
          <div>
            <label className="label">File</label>
            <Uploader name="url" />
          </div>
          <div>
            <label className="label" htmlFor="propertyId">Link to property (optional)</label>
            <select id="propertyId" name="propertyId" className="field" defaultValue="">
              <option value="">— None —</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.reference} · {p.title}</option>)}
            </select>
          </div>
          {state.error && <p className="text-sm text-danger">{state.error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save document"}</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
