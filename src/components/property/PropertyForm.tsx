"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createProperty, updateProperty, suggestPropertyCopy, type FormState } from "@/app/(app)/properties/actions";
import { humanize } from "@/lib/format";
import { CityAreaPicker } from "@/components/ui/CityAreaPicker";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { PROPERTY_TYPE_GROUPS, isLandType, isResidentialType } from "@/lib/property-types";
import { AMENITY_GROUPS } from "@/lib/amenities";

const STATUSES = ["AVAILABLE", "PENDING_VERIFICATION", "RESERVED", "UNDER_NEGOTIATION", "RENTED", "SOLD", "INACTIVE"];

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

/** Initial values for edit mode — what the property page already has on record.
 *  All optional/nullable so a partly-filled listing maps cleanly to the form. */
export interface PropertyInitial {
  id: string;
  version: number;
  title: string;
  description?: string | null;
  type: string;
  listingType: string;
  status: string;
  city?: string | null;
  area?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  salePrice?: number | null;
  monthlyRent?: number | null;
  deposit?: number | null;
  coveredArea?: number | null;
  plotSize?: number | null;
  areaUnit?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floors?: number | null;
  parking?: number | null;
  yearBuilt?: number | null;
  amenities?: string[];
  dealerId?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
}

interface PropertyFormProps {
  dealers: { id: string; name: string }[];
  canPickDealer: boolean;
  /** When provided (drawer context), Cancel closes the drawer instead of
   *  navigating to /properties. */
  onCancel?: () => void;
  /** When provided, the form runs in EDIT mode: fields are pre-filled and
   *  submitting calls updateProperty (optimistic-locked) instead of create. */
  property?: PropertyInitial;
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
 * Property form — detailed + interactive, and dynamic so only the fields that
 * fit the chosen Purpose/Type are shown.
 *   - Purpose (segmented): SALE shows sale price; RENT shows rent + deposit.
 *   - Type: residential shows bedrooms; PLOT (land) drops covered area, rooms,
 *     baths, floors, parking and year built — a plot has none of them.
 * Hidden fields aren't submitted, so the server stores null (no stale values).
 *
 * Two modes, same component:
 *   - CREATE (no `property`): blank, submits createProperty, redirects to the
 *     new listing.
 *   - EDIT (`property` given): pre-filled, submits updateProperty with the
 *     property id + optimistic-lock version, then closes the drawer on success.
 * Works inline (/properties/new) and inside the right-sliding Drawer (onCancel).
 */
export function PropertyForm({ dealers, canPickDealer, onCancel, property }: PropertyFormProps) {
  const isEdit = !!property;
  const [state, action, pending] = useActionState<FormState, FormData>(
    isEdit ? updateProperty : createProperty,
    {},
  );
  const [listingType, setListingType] = useState(property?.listingType ?? "SALE");
  const [type, setType] = useState(property?.type ?? "HOUSE");
  const [areaUnit, setAreaUnit] = useState(property?.areaUnit ?? "SQFT");
  const [bedrooms, setBedrooms] = useState(property?.bedrooms ?? 0);
  const [bathrooms, setBathrooms] = useState(property?.bathrooms ?? 0);
  const [floors, setFloors] = useState(property?.floors ?? 0);
  const [parking, setParking] = useState(property?.parking ?? 0);
  const [amenities, setAmenities] = useState<string[]>(property?.amenities ?? []);
  // Title + description are controlled so the AI writer can fill them.
  const [title, setTitle] = useState(property?.title ?? "");
  const [description, setDescription] = useState(property?.description ?? "");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Edit mode returns { ok } (no redirect) — close the drawer when it lands.
  useEffect(() => {
    if (state.ok) onCancel?.();
  }, [state.ok, onCancel]);

  const showSale = listingType === "SALE" || listingType === "BOTH";
  const showRent = listingType === "RENT" || listingType === "BOTH";
  const isLand = isLandType(type);
  const isResidential = isResidentialType(type);
  // Back-compat: if this listing's stored type predates the granular taxonomy
  // (e.g. "APARTMENT"), it won't be in the grouped options — surface it as its
  // own option so the select still shows the right value in edit mode.
  const knownType = PROPERTY_TYPE_GROUPS.some((g) => g.items.some((i) => i.value === type));

  const toggleAmenity = (a: string) =>
    setAmenities((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  // Pull the current field values straight off the form and ask the AI to
  // draft a title + description, then fill them in.
  async function writeWithAI() {
    setAiError(null);
    setAiBusy(true);
    try {
      const fd = new FormData(formRef.current!);
      const g = (k: string) => ((fd.get(k) as string) || "").trim();
      const res = await suggestPropertyCopy({
        type: g("type"), listingType: g("listingType"), city: g("city"), area: g("area"),
        bedrooms: g("bedrooms"), bathrooms: g("bathrooms"), coveredArea: g("coveredArea"),
        plotSize: g("plotSize"), areaUnit: g("areaUnit"), salePrice: g("salePrice"),
        monthlyRent: g("monthlyRent"), amenities: g("amenities"),
      });
      if (res.ok) {
        if (res.title) setTitle(res.title);
        if (res.description) setDescription(res.description);
      } else {
        setAiError(res.error);
      }
    } catch {
      setAiError("Couldn't reach the AI service. Please try again.");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <form ref={formRef} action={action} className="space-y-6">
      {isEdit && (
        <>
          <input type="hidden" name="id" value={property!.id} />
          <input type="hidden" name="version" value={property!.version} />
        </>
      )}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <SectionTitle>Basics</SectionTitle>
          <button
            type="button"
            onClick={writeWithAI}
            disabled={aiBusy}
            className="btn-ghost -mt-3 px-2.5 py-1 text-xs"
            title="Generate a title and description from the details you've entered"
          >
            {aiBusy ? "Writing…" : "✨ Write with AI"}
          </button>
        </div>
        {aiError && <p className="mb-3 -mt-1 text-xs text-danger">{aiError}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="title">Title</label>
            <input id="title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} className="field" placeholder="e.g. 4-Bed Sea-Facing Apartment" required />
            <Err state={state} name="title" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Purpose</label>
            <Segmented name="listingType" value={listingType} onChange={setListingType} options={PURPOSE_OPTS} />
          </div>
          <div>
            <label className="label" htmlFor="type">Type</label>
            <select id="type" name="type" className="field" value={type} onChange={(e) => setType(e.target.value)}>
              {!knownType && <option value={type}>{humanize(type)}</option>}
              {PROPERTY_TYPE_GROUPS.map((g) => (
                <optgroup key={g.category} label={g.category}>
                  {g.items.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select id="status" name="status" className="field" defaultValue={property?.status ?? "AVAILABLE"}>
              {STATUSES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </div>
          {canPickDealer && (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="dealerId">Dealer (optional)</label>
              <select id="dealerId" name="dealerId" className="field" defaultValue={property?.dealerId ?? ""}>
                <option value="">— Private owner —</option>
                {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="field" placeholder="Highlight the selling points… or tap ✨ Write with AI" />
          </div>
        </div>
      </section>

      <section className="border-t border-line pt-5">
        <SectionTitle>Location &amp; pricing</SectionTitle>
        <div className="space-y-4">
          <CityAreaPicker cityName="city" areaName="area" defaultCity={property?.city} defaultArea={property?.area} />
          <div>
            <label className="label" htmlFor="address">Address</label>
            <AddressAutocomplete name="address" latName="latitude" lonName="longitude" defaultValue={property?.address ?? ""} defaultLat={property?.latitude} defaultLon={property?.longitude} />
          </div>
          {(showSale || showRent) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {showSale && <div><label className="label" htmlFor="salePrice">Sale price (PKR)</label><input id="salePrice" name="salePrice" type="number" min="0" className="field" defaultValue={property?.salePrice ?? ""} /></div>}
              {showRent && <div><label className="label" htmlFor="monthlyRent">Monthly rent (PKR)</label><input id="monthlyRent" name="monthlyRent" type="number" min="0" className="field" defaultValue={property?.monthlyRent ?? ""} /></div>}
              {showRent && <div><label className="label" htmlFor="deposit">Security deposit (PKR)</label><input id="deposit" name="deposit" type="number" min="0" className="field" defaultValue={property?.deposit ?? ""} /></div>}
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
              <input id="plotSize" name="plotSize" type="number" min="0" step="any" className="field" placeholder="e.g. 10" defaultValue={property?.plotSize ?? ""} />
            </div>
            {!isLand && (
              <div><label className="label" htmlFor="coveredArea">Covered area (sq.ft)</label><input id="coveredArea" name="coveredArea" type="number" min="0" className="field" placeholder="e.g. 1800" defaultValue={property?.coveredArea ?? ""} /></div>
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
            <div className="sm:max-w-[220px]"><label className="label" htmlFor="yearBuilt">Year built</label><input id="yearBuilt" name="yearBuilt" type="number" min="1900" max="2100" className="field" placeholder="e.g. 2021" defaultValue={property?.yearBuilt ?? ""} /></div>
          )}
        </div>
      </section>

      <section className="border-t border-line pt-5">
        <SectionTitle>Features &amp; amenities</SectionTitle>
        <div className="space-y-4">
          {AMENITY_GROUPS.map((group) => (
            <div key={group.category}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted/80">{group.category}</p>
              <div className="flex flex-wrap gap-2">
                {group.items.map((a) => {
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
            </div>
          ))}
        </div>
        <input type="hidden" name="amenities" value={amenities.join(",")} />
        {amenities.length > 0 && <p className="mt-3 text-xs text-muted">{amenities.length} selected</p>}
      </section>

      <section className="border-t border-line pt-5">
        <SectionTitle>Owner</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="ownerName">Owner name</label><input id="ownerName" name="ownerName" className="field" defaultValue={property?.ownerName ?? ""} /></div>
          <div><label className="label" htmlFor="ownerPhone">Owner phone</label><input id="ownerPhone" name="ownerPhone" className="field" placeholder="03xx-xxxxxxx" defaultValue={property?.ownerPhone ?? ""} /></div>
        </div>
      </section>

      {state.error && <p className="rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{state.error}</p>}

      <div className={onCancel
        ? "sticky bottom-0 -mx-5 -mb-5 flex gap-2 border-t border-line bg-paper px-5 py-3"
        : "flex gap-2 pt-2"}>
        <button type="submit" disabled={pending} className="btn-accent">{pending ? "Saving…" : isEdit ? "Save changes" : "Save property"}</button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
        ) : (
          <Link href="/properties" className="btn-ghost">Cancel</Link>
        )}
      </div>
    </form>
  );
}
