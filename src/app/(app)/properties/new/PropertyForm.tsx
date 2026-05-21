"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createProperty, type FormState } from "../actions";
import { humanize } from "@/lib/format";

const TYPES = ["APARTMENT", "VILLA", "RESIDENTIAL", "COMMERCIAL", "PLOT", "SHOP", "OFFICE"];
const LISTING = ["SALE", "RENT", "BOTH"];
const STATUSES = ["AVAILABLE", "PENDING_VERIFICATION", "RESERVED", "UNDER_NEGOTIATION", "RENTED", "SOLD", "INACTIVE"];

interface PropertyFormProps {
  dealers: { id: string; name: string }[];
  canPickDealer: boolean;
}

function Err({ state, name }: { state: FormState; name: string }) {
  const msg = state.fieldErrors?.[name]?.[0];
  return msg ? <p className="mt-1 text-xs text-danger">{msg}</p> : null;
}

export function PropertyForm({ dealers, canPickDealer }: PropertyFormProps) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProperty, {});

  return (
    <form action={action} className="space-y-6">
      <div className="surface p-6">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink">Basics</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="title">Title</label>
            <input id="title" name="title" className="field" placeholder="e.g. 4-Bed Sea-Facing Apartment" required />
            <Err state={state} name="title" />
          </div>
          <div>
            <label className="label" htmlFor="type">Type</label>
            <select id="type" name="type" className="field" defaultValue="APARTMENT">
              {TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="listingType">Purpose</label>
            <select id="listingType" name="listingType" className="field" defaultValue="SALE">
              {LISTING.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select id="status" name="status" className="field" defaultValue="AVAILABLE">
              {STATUSES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          {canPickDealer && (
            <div>
              <label className="label" htmlFor="dealerId">Dealer (optional)</label>
              <select id="dealerId" name="dealerId" className="field" defaultValue="">
                <option value="">— Private owner —</option>
                {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" name="description" rows={3} className="field" />
          </div>
        </div>
      </div>

      <div className="surface p-6">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink">Location &amp; pricing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="city">City</label><input id="city" name="city" className="field" /></div>
          <div><label className="label" htmlFor="area">Area / locality</label><input id="area" name="area" className="field" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="address">Address</label><input id="address" name="address" className="field" /></div>
          <div><label className="label" htmlFor="salePrice">Sale price (PKR)</label><input id="salePrice" name="salePrice" type="number" min="0" className="field" /></div>
          <div><label className="label" htmlFor="monthlyRent">Monthly rent (PKR)</label><input id="monthlyRent" name="monthlyRent" type="number" min="0" className="field" /></div>
          <div><label className="label" htmlFor="deposit">Security deposit (PKR)</label><input id="deposit" name="deposit" type="number" min="0" className="field" /></div>
        </div>
      </div>

      <div className="surface p-6">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink">Layout &amp; owner</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label className="label" htmlFor="bedrooms">Bedrooms</label><input id="bedrooms" name="bedrooms" type="number" min="0" className="field" /></div>
          <div><label className="label" htmlFor="bathrooms">Bathrooms</label><input id="bathrooms" name="bathrooms" type="number" min="0" className="field" /></div>
          <div><label className="label" htmlFor="coveredArea">Covered area (sqft)</label><input id="coveredArea" name="coveredArea" type="number" min="0" className="field" /></div>
          <div><label className="label" htmlFor="ownerName">Owner name</label><input id="ownerName" name="ownerName" className="field" /></div>
          <div><label className="label" htmlFor="ownerPhone">Owner phone</label><input id="ownerPhone" name="ownerPhone" className="field" /></div>
        </div>
      </div>

      {state.error && <p className="rounded-lg border border-red-200 bg-danger-bg px-3 py-2 text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-accent">{pending ? "Saving…" : "Save property"}</button>
        <Link href="/properties" className="btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}
