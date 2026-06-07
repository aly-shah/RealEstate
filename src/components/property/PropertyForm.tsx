"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createProperty, type FormState } from "@/app/(app)/properties/actions";
import { humanize } from "@/lib/format";
import { CityAreaPicker } from "@/components/ui/CityAreaPicker";

const TYPES = ["APARTMENT", "VILLA", "RESIDENTIAL", "COMMERCIAL", "PLOT", "SHOP", "OFFICE"];
const STATUSES = ["AVAILABLE", "PENDING_VERIFICATION", "RESERVED", "UNDER_NEGOTIATION", "RENTED", "SOLD", "INACTIVE"];
const RESIDENTIAL_TYPES = new Set(["APARTMENT", "VILLA", "RESIDENTIAL"]);

const PURPOSE_OPTS = [
  { value: "SALE", label: "Sale" },
  { value: "RENT", label: "Rent" },
  { value: "BOTH", label: "Both" },
];
const UNIT_OPTS = [
  { value: "SQFT", label: "Sq.ft" },
  { value: "SQYD", label: "Sq.yd" },
  { value: "MARLA", label: "Marla" },
  { value: "KANAL", label: "Kanal" },
  { value: "SQM", label: "Sq.m" },
];
// Must mirror the AMENITIES allow-list in properties/actions.ts.
const AMENITIES = [
  "Parking", "Lift / Elevator", "Backup Generator", "Security / Guard", "CCTV",
  "Servant Quarter", "Gym", "Swimming Pool", "Garden / Lawn", "Mosque Nearby",
  "Furnished", "Gas Connection", "Solar Panels", "Boundary Wall", "Corner",
  "Park Facing", "Main Road", "Water Boring",
];

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

/** Segmented pill control backed by a hidden input so it submits with the form. */
function Segmented({
  name, value, onChange, options,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-xl border border-line bg-canvas p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            value === o.value ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

/** −/+ counter that submits via a read-only input (its value posts with the form). */
function Stepper({
  name, label, value, set, max = 50,
}: {
  name: string;
  label: string;
  value: number;
  set: (n: number) => void;
  max?: number;
}) {
  const btn = "grid h-9 w-9 shrink-0 place-items-center text-lg text-muted transition hover:text-ink disabled:opacity-40";
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <div className="flex items-center rounded-xl border border-line bg-paper">
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= 0} onClick={() => set(Math.max(0, value - 1))} className={btn}>−</button>
        <input id={name} name={name} value={value} readOnly inputMode="numeric" aria-label={label}
          className="w-full min-w-0 border-0 bg-transparent text-center text-sm font-semibold text-ink focus:outline-none" />
        <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => set(Math.min(max, value + 1))} className={btn}>+</button>
      </div>
    </div>
  );
}

/**
 * Create-property form — detailed + interactive, and dynamic so only the fields
 * that fit the chosen Purpose/Type are shown.
 *   - Purpose (segmented): SALE shows sale price; RENT shows rent + deposit.
 *   - Type: residential shows bedrooms; PLOT (land) drops covered area, rooms,
 *     baths, floors, parking and year built — a plot has none of them.
 * Hidden fields aren't submitted, so the server stores null (no stale values).
 * Works inline (/properties/new) and inside the right-sliding Drawer (onCancel).
 */
export function PropertyForm({ dealers, canPickDealer, onCancel }: PropertyFormProps) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProperty, {});
  const [listingType, setListingType] = useState("SALE");
  const [type, setType] = useState("APARTMENT");
  const [areaUnit, setAreaUnit] = useState("SQFT");
  const [bedrooms, setBedrooms] = useState(0);
  const [bathrooms, setBathrooms] = useState(0);
  const [floors, setFloors] = useState(0);
  const [parking, setParking] = useState(0);
  const [amenities, setAmenities] = useState<string[]>([]);

  const showSale = listingType === "SALE" || listingType === "BOTH";
  const showRent = listingType === "RENT" || listingType === "BOTH";
  const isLand = type === "PLOT";
  const isResidential = RESIDENTIAL_TYPES.has(type);

  const toggleAmenity = (a: string) =>
    setAmenities((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

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
          <div className="sm:col-span-2">
            <label className="label">Purpose</label>
            <Segmented name="listingType" value={listingType} onChange={setListingType} options={PURPOSE_OPTS} />
          </div>
          <div>
            <label className="label" htmlFor="type">Type</label>
            <select id="type" name="type" className="field" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select id="status" name="status" className="field" defaultValue="AVAILABLE">
              {STATUSES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          {canPickDealer && (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="dealerId">Dealer (optional)</label>
              <select id="dealerId" name="dealerId" className="field" defaultValue="">
                <option value="">— Private owner —</option>
                {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" name="description" rows={3} className="field" placeholder="Highlight the selling points…" />
          </div>
        </div>
      </section>

      <section className="border-t border-line pt-5">
        <SectionTitle>Location &amp; pricing</SectionTitle>
        <div className="space-y-4">
          <CityAreaPicker cityName="city" areaName="area" />
          <div><label className="label" htmlFor="address">Address</label><input id="address" name="address" className="field" /></div>
          {(showSale || showRent) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {showSale && <div><label className="label" htmlFor="salePrice">Sale price (PKR)</label><input id="salePrice" name="salePrice" type="number" min="0" className="field" /></div>}
              {showRent && <div><label className="label" htmlFor="monthlyRent">Monthly rent (PKR)</label><input id="monthlyRent" name="monthlyRent" type="number" min="0" className="field" /></div>}
              {showRent && <div><label className="label" htmlFor="deposit">Security deposit (PKR)</label><input id="deposit" name="deposit" type="number" min="0" className="field" /></div>}
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-line pt-5">
        <SectionTitle>Area &amp; layout</SectionTitle>
        <div className="space-y-4">
          <div>
            <label className="label">Area unit</label>
            <Segmented name="areaUnit" value={areaUnit} onChange={setAreaUnit} options={UNIT_OPTS} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="plotSize">Total area ({UNIT_OPTS.find((u) => u.value === areaUnit)?.label})</label>
              <input id="plotSize" name="plotSize" type="number" min="0" step="any" className="field" placeholder="e.g. 10" />
            </div>
            {!isLand && (
              <div><label className="label" htmlFor="coveredArea">Covered area (sq.ft)</label><input id="coveredArea" name="coveredArea" type="number" min="0" className="field" placeholder="e.g. 1800" /></div>
            )}
          </div>
          {!isLand && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {isResidential && <Stepper name="bedrooms" label="Bedrooms" value={bedrooms} set={setBedrooms} />}
              <Stepper name="bathrooms" label="Bathrooms" value={bathrooms} set={setBathrooms} />
              <Stepper name="floors" label="Floors" value={floors} set={setFloors} max={200} />
              <Stepper name="parking" label="Parking" value={parking} set={setParking} />
            </div>
          )}
          {!isLand && (
            <div className="sm:max-w-[220px]"><label className="label" htmlFor="yearBuilt">Year built</label><input id="yearBuilt" name="yearBuilt" type="number" min="1900" max="2100" className="field" placeholder="e.g. 2021" /></div>
          )}
        </div>
      </section>

      <section className="border-t border-line pt-5">
        <SectionTitle>Amenities</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {AMENITIES.map((a) => {
            const on = amenities.includes(a);
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggleAmenity(a)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  on ? "border-accent bg-accent/10 text-accent" : "border-line bg-paper text-muted hover:border-accent/40 hover:text-ink"
                }`}
              >
                {on ? "✓ " : ""}{a}
              </button>
            );
          })}
        </div>
        <input type="hidden" name="amenities" value={amenities.join(",")} />
        {amenities.length > 0 && <p className="mt-2 text-xs text-muted">{amenities.length} selected</p>}
      </section>

      <section className="border-t border-line pt-5">
        <SectionTitle>Owner</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="ownerName">Owner name</label><input id="ownerName" name="ownerName" className="field" /></div>
          <div><label className="label" htmlFor="ownerPhone">Owner phone</label><input id="ownerPhone" name="ownerPhone" className="field" placeholder="03xx-xxxxxxx" /></div>
        </div>
      </section>

      {state.error && <p className="rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{state.error}</p>}

      <div className={onCancel
        ? "sticky bottom-0 -mx-5 -mb-5 flex gap-2 border-t border-line bg-paper px-5 py-3"
        : "flex gap-2 pt-2"}>
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
