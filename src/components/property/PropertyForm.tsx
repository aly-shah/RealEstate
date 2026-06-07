"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createProperty, type FormState } from "@/app/(app)/properties/actions";
import { humanize } from "@/lib/format";
import { CityAreaPicker } from "@/components/ui/CityAreaPicker";

const TYPES = ["APARTMENT", "VILLA", "RESIDENTIAL", "COMMERCIAL", "PLOT", "SHOP", "OFFICE"];
const LISTING = ["SALE", "RENT", "BOTH"];
const STATUSES = ["AVAILABLE", "PENDING_VERIFICATION", "RESERVED", "UNDER_NEGOTIATION", "RENTED", "SOLD", "INACTIVE"];

const RESIDENTIAL_TYPES = new Set(["APARTMENT", "VILLA", "RESIDENTIAL"]);

interface PropertyFormProps {
  dealers: { id: string; name: string }[];
  canPickDealer: boolean;
  /** When provided (drawer context), Cancel closes the drawer instead of
   *  navigating to /properties. */
  onCancel?: () => void;
}

function Err({ state, name }: { state: FormState; name: string }) {
  const msg = state.fieldErrors?.[name]?.[0];
  return msg ? <p className="mt-1 text-xs text-danger">{msg}</p> : null;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">{children}</h3>;
}

/**
 * Create-property form. Dynamic: the fields shown follow the two choices that
 * drive everything else —
 *   - Purpose (listingType): SALE shows sale price; RENT shows rent + deposit;
 *     BOTH shows all three. A rental never carries a sale price, etc.
 *   - Type: residential types show bedrooms; land (PLOT) drops bedrooms,
 *     bathrooms and covered area entirely (a plot has none of them).
 * Hidden fields simply aren't submitted, so the server stores null — no stale
 * sale price left on a rental. Works both inline (/properties/new) and inside
 * the right-sliding Drawer (pass onCancel).
 */
export function PropertyForm({ dealers, canPickDealer, onCancel }: PropertyFormProps) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProperty, {});
  const [listingType, setListingType] = useState("SALE");
  const [type, setType] = useState("APARTMENT");

  const showSale = listingType === "SALE" || listingType === "BOTH";
  const showRent = listingType === "RENT" || listingType === "BOTH";
  const isLand = type === "PLOT";
  const isResidential = RESIDENTIAL_TYPES.has(type);

  return (
    <form action={action} className="space-y-6">
      <section>
        <SectionTitle>Basics</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="title">Title</label>
            <input id="title" name="title" className="field" placeholder="e.g. 4-Bed Sea-Facing Apartment" required />
            <Err state={state} name="title" />
          </div>
          <div>
            <label className="label" htmlFor="type">Type</label>
            <select id="type" name="type" className="field" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="listingType">Purpose</label>
            <select id="listingType" name="listingType" className="field" value={listingType} onChange={(e) => setListingType(e.target.value)}>
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
      </section>

      <section className="border-t border-line pt-5">
        <SectionTitle>Location &amp; pricing</SectionTitle>
        <div className="space-y-4">
          <CityAreaPicker cityName="city" areaName="area" />
          <div><label className="label" htmlFor="address">Address</label><input id="address" name="address" className="field" /></div>
          {/* Price fields follow Purpose — a SALE listing has no rent, etc. */}
          {(showSale || showRent) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {showSale && (
                <div><label className="label" htmlFor="salePrice">Sale price (PKR)</label><input id="salePrice" name="salePrice" type="number" min="0" className="field" /></div>
              )}
              {showRent && (
                <div><label className="label" htmlFor="monthlyRent">Monthly rent (PKR)</label><input id="monthlyRent" name="monthlyRent" type="number" min="0" className="field" /></div>
              )}
              {showRent && (
                <div><label className="label" htmlFor="deposit">Security deposit (PKR)</label><input id="deposit" name="deposit" type="number" min="0" className="field" /></div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Layout — only the parts that make sense for the chosen Type. A plot has
          no rooms or covered area, so the whole grid collapses to owner fields. */}
      <section className="border-t border-line pt-5">
        <SectionTitle>Layout &amp; owner</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          {isResidential && (
            <div><label className="label" htmlFor="bedrooms">Bedrooms</label><input id="bedrooms" name="bedrooms" type="number" min="0" className="field" /></div>
          )}
          {!isLand && (
            <div><label className="label" htmlFor="bathrooms">Bathrooms</label><input id="bathrooms" name="bathrooms" type="number" min="0" className="field" /></div>
          )}
          {!isLand && (
            <div><label className="label" htmlFor="coveredArea">Covered area (sqft)</label><input id="coveredArea" name="coveredArea" type="number" min="0" className="field" /></div>
          )}
          <div><label className="label" htmlFor="ownerName">Owner name</label><input id="ownerName" name="ownerName" className="field" /></div>
          <div><label className="label" htmlFor="ownerPhone">Owner phone</label><input id="ownerPhone" name="ownerPhone" className="field" /></div>
        </div>
      </section>

      {state.error && <p className="rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-accent">{pending ? "Saving…" : "Save property"}</button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
        ) : (
          <Link href="/properties" className="btn-ghost">Cancel</Link>
        )}
      </div>
    </form>
  );
}
