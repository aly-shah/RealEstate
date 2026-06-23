"use client";

import { useActionState, useState } from "react";
import { createBooking, type FormState } from "./actions";
import { Drawer } from "@/components/ui/Drawer";

interface Unit { id: string; label: string; price: number }
interface Client { id: string; name: string }

/** Book an available unit for a buyer. Picking a unit prefills its list price. */
export function NewBookingButton({ units, clients }: { units: Unit[]; clients: Client[] }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState<number | "">("");
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const r = await createBooking(p, fd);
    if (r.ok) setOpen(false);
    return r;
  }, {});

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-accent" disabled={units.length === 0} title={units.length === 0 ? "No available units to book" : ""}>+ New booking</button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Book a unit" description="Reserve an available unit for a buyer (pending approval)." width="md">
        <form action={action} className="space-y-3">
          {state.error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{state.error}</p>}
          <div>
            <label className="label" htmlFor="b-unit">Unit</label>
            <select
              id="b-unit" name="propertyId" className="field" required defaultValue=""
              onChange={(e) => { const u = units.find((x) => x.id === e.target.value); if (u) setPrice(u.price || ""); }}
            >
              <option value="" disabled>— Pick a unit —</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="b-client">Buyer (existing client)</label>
            <select id="b-client" name="clientId" className="field" defaultValue="">
              <option value="">— New buyer (enter below) —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="b-name">Buyer name</label><input id="b-name" name="clientName" className="field" placeholder="If not an existing client" /></div>
            <div><label className="label" htmlFor="b-phone">Buyer phone</label><input id="b-phone" name="clientPhone" className="field" placeholder="+92…" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="b-price">Agreed price (PKR)</label>
              <input id="b-price" name="price" type="number" min="0" className="field" required value={price} onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            <div><label className="label" htmlFor="b-discount">Discount (optional)</label><input id="b-discount" name="discount" type="number" min="0" className="field" /></div>
          </div>
          <div><label className="label" htmlFor="b-notes">Notes</label><textarea id="b-notes" name="notes" rows={2} className="field" /></div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={pending} className="btn-accent">{pending ? "Booking…" : "Book unit"}</button>
          </div>
        </form>
      </Drawer>
    </>
  );
}
