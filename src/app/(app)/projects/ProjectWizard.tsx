"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProjectFull, aiProjectDescription, type ProjectWizardInput } from "./actions";
import { Drawer } from "@/components/ui/Drawer";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { MapView, type MapMarker } from "@/components/map/MapView";

const STATUSES = ["PLANNING", "PRE_LAUNCH", "SELLING", "SOLD_OUT", "COMPLETED", "ON_HOLD"];
const AREA_UNITS = ["SQFT", "SQYD", "SQM", "MARLA", "KANAL"];
// Mirrors PROJECT_AMENITIES in actions.ts.
const AMENITIES = [
  "Swimming Pool", "Gym", "Parking", "Garage", "Shops / Retail", "Lift / Elevator",
  "Backup Generator", "Security / Guards", "CCTV", "Mosque", "Community Park",
  "Kids Play Area", "Clubhouse", "Rooftop Terrace", "Standby Power", "Water Filtration",
];
const STEPS = ["Details", "Location", "Amenities", "Unit types", "Inventory", "Description"];

interface TypeRow { key: string; name: string; bedrooms: string; bathrooms: string; areaValue: string; areaUnit: string; basePrice: string; floorRise: string }
interface BatchRow { key: string; tower: string; floorFrom: string; floorTo: string; unitsPerFloor: string; unitTypeKey: string }

const newKey = () => Math.random().toString(36).slice(2, 10);
const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function ProjectWizard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [aiBusy, startAi] = useTransition();

  // Step 1 — details
  const [name, setName] = useState("");
  const [status, setStatus] = useState("PLANNING");
  const [isOffPlan, setIsOffPlan] = useState(true);
  const [totalFloors, setTotalFloors] = useState("");
  const [launchDate, setLaunchDate] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  // Step 2 — location
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Step 3 — amenities
  const [amenities, setAmenities] = useState<string[]>([]);
  // Step 4 / 5
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  // Step 6
  const [description, setDescription] = useState("");

  function reset() {
    setStep(0); setError(null);
    setName(""); setStatus("PLANNING"); setIsOffPlan(true); setTotalFloors(""); setLaunchDate(""); setCompletionDate("");
    setAddress(""); setCity(""); setArea(""); setCoords(null); setAmenities([]);
    setTypes([]); setBatches([]); setDescription("");
  }
  const close = () => setOpen(false);
  const toggleAmenity = (a: string) => setAmenities((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]));

  const totalUnits = batches.reduce((s, b) => {
    const f = Number(b.floorFrom), t = Number(b.floorTo), u = Number(b.unitsPerFloor);
    return s + (Number.isFinite(f) && Number.isFinite(t) && t >= f ? (t - f + 1) * (u || 0) : 0);
  }, 0);

  function validateStep(): string | null {
    if (step === 0 && name.trim().length < 2) return "Enter a project name.";
    if (step === 3) {
      for (const t of types) {
        if (!t.name.trim()) return "Every unit type needs a name.";
        if (t.basePrice.trim() === "" || Number(t.basePrice) < 0) return `Set a base price for "${t.name || "the type"}".`;
      }
    }
    if (step === 4) {
      for (const b of batches) {
        if (!b.tower.trim()) return "Every inventory row needs a tower.";
        if (!b.unitTypeKey) return "Pick a unit type for each inventory row.";
        if (Number(b.floorTo) < Number(b.floorFrom)) return `Tower ${b.tower}: top floor must be ≥ bottom floor.`;
      }
    }
    return null;
  }

  function next() {
    const err = validateStep();
    if (err) return setError(err);
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  const back = () => { setError(null); setStep((s) => Math.max(0, s - 1)); };

  function buildPayload(): ProjectWizardInput {
    return {
      name: name.trim(), status: status as ProjectWizardInput["status"],
      city: city.trim() || undefined, area: area.trim() || undefined, address: address.trim() || undefined,
      latitude: coords?.lat ?? null, longitude: coords?.lng ?? null,
      totalFloors: num(totalFloors), description: description.trim() || undefined,
      isOffPlan, launchDate: launchDate || undefined, completionDate: completionDate || undefined,
      amenities,
      unitTypes: types.map((t) => ({
        key: t.key, name: t.name.trim(), bedrooms: num(t.bedrooms), bathrooms: num(t.bathrooms),
        areaValue: num(t.areaValue), areaUnit: t.areaUnit as "SQFT" | "SQM" | "SQYD" | "MARLA" | "KANAL",
        basePrice: Number(t.basePrice), floorRise: Number(t.floorRise || 0),
      })),
      batches: batches.map((b) => ({ tower: b.tower.trim(), floorFrom: Number(b.floorFrom), floorTo: Number(b.floorTo), unitsPerFloor: Number(b.unitsPerFloor), unitTypeKey: b.unitTypeKey })),
    };
  }

  function writeWithAi() {
    setError(null);
    startAi(async () => {
      const r = await aiProjectDescription({
        name: name.trim(), status, city: city.trim(), area: area.trim(), address: address.trim(),
        totalFloors: num(totalFloors), isOffPlan, amenities,
        unitTypes: types.map((t) => ({ name: t.name.trim(), basePrice: num(t.basePrice) })),
        launchDate: launchDate || undefined, completionDate: completionDate || undefined,
      });
      if (!r.ok) return setError(r.reason);
      setDescription(r.description);
    });
  }

  function submit() {
    const err = validateStep();
    if (err) return setError(err);
    setError(null);
    start(async () => {
      const r = await createProjectFull(buildPayload());
      if (!r.ok) return setError(r.error);
      close();
      router.push(`/projects/${r.projectId}`);
    });
  }

  const marker: MapMarker[] = coords ? [{ id: "loc", title: name || "Project", reference: "", lat: coords.lat, lng: coords.lng, status: "AVAILABLE", price: "", href: "#" }] : [];

  return (
    <>
      <button onClick={() => { reset(); setOpen(true); }} className="btn-accent">+ New project</button>
      <Drawer open={open} onClose={close} title="New project" description={STEPS[step]} width="xl">
        {/* Stepper */}
        <ol className="mb-5 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${i < step ? "bg-accent text-white" : i === step ? "brand-gradient text-white" : "bg-line-soft text-muted"}`}>{i < step ? "✓" : i + 1}</span>
              <span className={i === step ? "font-semibold text-ink" : "text-muted"}>{s}</span>
              {i < STEPS.length - 1 && <span className="mx-1 hidden h-px w-4 bg-line sm:inline-block" />}
            </li>
          ))}
        </ol>

        {error && <p className="mb-3 rounded-lg bg-danger-bg px-3 py-2 text-xs font-medium text-danger">{error}</p>}

        {/* Step 1 — Details */}
        {step === 0 && (
          <div className="space-y-4">
            <div><label className="label" htmlFor="w-name">Project name</label><input id="w-name" className="field text-ink" value={name} onChange={(e) => setName(e.target.value)} placeholder="Skyline Towers" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="w-status">Status</label>
                <select id="w-status" className="field text-ink" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
              </div>
              <div><label className="label" htmlFor="w-floors">Total floors</label><input id="w-floors" type="number" min="0" className="field text-ink" value={totalFloors} onChange={(e) => setTotalFloors(e.target.value)} placeholder="e.g. 20" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="w-start">Construction start</label><input id="w-start" type="date" className="field text-ink" value={launchDate} onChange={(e) => setLaunchDate(e.target.value)} /></div>
              <div><label className="label" htmlFor="w-finish">Expected completion</label><input id="w-finish" type="date" className="field text-ink" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" className="h-4 w-4 rounded border-line" checked={isOffPlan} onChange={(e) => setIsOffPlan(e.target.checked)} /> Off-plan (under construction)</label>
          </div>
        )}

        {/* Step 2 — Location */}
        {step === 1 && (
          <div className="space-y-3">
            <div>
              <label className="label">Search the address</label>
              <AddressAutocomplete
                defaultValue={address}
                placeholder="Start typing — e.g. DHA Phase 8, Karachi"
                onPick={(s) => { setAddress(s.label); setCoords({ lat: s.lat, lng: s.lon }); }}
                onClear={() => setCoords(null)}
              />
              <p className="mt-1 text-xs text-muted">{coords ? `📍 Pinned at ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : "Pick a suggestion to drop a pin on the map."}</p>
            </div>
            {coords && (
              <div className="overflow-hidden rounded-xl border border-line"><MapView markers={marker} height={220} single zoom={15} /></div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="w-city">City</label><input id="w-city" className="field text-ink" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Karachi" /></div>
              <div><label className="label" htmlFor="w-area">Area / locality</label><input id="w-area" className="field text-ink" value={area} onChange={(e) => setArea(e.target.value)} placeholder="DHA Phase 8" /></div>
            </div>
          </div>
        )}

        {/* Step 3 — Amenities */}
        {step === 2 && (
          <div>
            <p className="mb-3 text-xs text-muted">Tick the facilities this project offers — these show to dealers & buyers and feed the AI description.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AMENITIES.map((a) => {
                const on = amenities.includes(a);
                return (
                  <button key={a} type="button" onClick={() => toggleAmenity(a)} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-start text-sm transition ${on ? "border-accent bg-accent-wash font-semibold text-accent" : "border-line text-ink hover:border-accent-line"}`}>
                    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? "border-accent bg-accent text-white" : "border-line"}`}>{on ? "✓" : ""}</span>
                    {a}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 4 — Unit types */}
        {step === 3 && (
          <div className="space-y-2">
            <p className="text-xs text-muted">Define the layouts and pricing (floor-rise adds to the price on higher floors). Optional — you can add these later.</p>
            {types.map((t, i) => (
              <div key={t.key} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-muted">Type {i + 1}</span><button type="button" onClick={() => setTypes((r) => r.filter((_, j) => j !== i))} className="text-xs text-danger">Remove</button></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <input className="field text-ink" placeholder="Name (2-Bed)" value={t.name} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <input className="field text-ink" type="number" min="0" placeholder="Beds" value={t.bedrooms} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, bedrooms: e.target.value } : x))} />
                  <input className="field text-ink" type="number" min="0" placeholder="Baths" value={t.bathrooms} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, bathrooms: e.target.value } : x))} />
                  <div className="flex gap-1">
                    <input className="field text-ink" type="number" min="0" placeholder="Area" value={t.areaValue} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, areaValue: e.target.value } : x))} />
                    <select className="field !w-20 text-ink" value={t.areaUnit} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, areaUnit: e.target.value } : x))}>{AREA_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
                  </div>
                  <input className="field text-ink" type="number" min="0" placeholder="Base price (PKR)" value={t.basePrice} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, basePrice: e.target.value } : x))} />
                  <input className="field text-ink" type="number" min="0" placeholder="Floor rise / floor" value={t.floorRise} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, floorRise: e.target.value } : x))} />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setTypes((r) => [...r, { key: newKey(), name: "", bedrooms: "", bathrooms: "", areaValue: "", areaUnit: "SQFT", basePrice: "", floorRise: "" }])} className="btn-ghost text-xs">+ Add unit type</button>
          </div>
        )}

        {/* Step 5 — Inventory */}
        {step === 4 && (
          <div className="space-y-2">
            {types.length === 0 ? (
              <p className="rounded-lg border border-line bg-canvas/50 px-3 py-2 text-xs text-muted">Add a unit type first to generate inventory — or skip and do it on the project page.</p>
            ) : (
              <>
                <p className="text-xs text-muted">For each tower, set which floors have apartments and how many per floor{totalFloors ? ` (this building has ${totalFloors} floors)` : ""}.</p>
                {batches.map((b, i) => (
                  <div key={b.key} className="grid grid-cols-2 gap-2 rounded-xl border border-line p-3 sm:grid-cols-6">
                    <input className="field text-ink" placeholder="Tower (A)" value={b.tower} onChange={(e) => setBatches((r) => r.map((x, j) => j === i ? { ...x, tower: e.target.value } : x))} />
                    <input className="field text-ink" type="number" placeholder="Floor from" value={b.floorFrom} onChange={(e) => setBatches((r) => r.map((x, j) => j === i ? { ...x, floorFrom: e.target.value } : x))} />
                    <input className="field text-ink" type="number" placeholder="Floor to" value={b.floorTo} onChange={(e) => setBatches((r) => r.map((x, j) => j === i ? { ...x, floorTo: e.target.value } : x))} />
                    <input className="field text-ink" type="number" min="1" placeholder="Per floor" value={b.unitsPerFloor} onChange={(e) => setBatches((r) => r.map((x, j) => j === i ? { ...x, unitsPerFloor: e.target.value } : x))} />
                    <select className="field text-ink" value={b.unitTypeKey} onChange={(e) => setBatches((r) => r.map((x, j) => j === i ? { ...x, unitTypeKey: e.target.value } : x))}><option value="">Type…</option>{types.map((t) => <option key={t.key} value={t.key}>{t.name || "Unnamed"}</option>)}</select>
                    <button type="button" onClick={() => setBatches((r) => r.filter((_, j) => j !== i))} className="btn-ghost !px-2 text-danger">✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => setBatches((r) => [...r, { key: newKey(), tower: "", floorFrom: "1", floorTo: totalFloors || "10", unitsPerFloor: "4", unitTypeKey: types[0]?.key ?? "" }])} className="btn-ghost text-xs">+ Add tower</button>
                {totalUnits > 0 && <p className="text-xs font-medium text-accent">{totalUnits} unit(s) will be generated.</p>}
              </>
            )}
          </div>
        )}

        {/* Step 6 — Description & review */}
        {step === 5 && (
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="label !mb-0" htmlFor="w-desc">Description</label>
                <button type="button" onClick={writeWithAi} disabled={aiBusy || name.trim().length < 2} className="btn-ghost text-xs text-accent">{aiBusy ? "Writing…" : "✨ Write with AI"}</button>
              </div>
              <textarea id="w-desc" rows={4} className="field text-ink" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the project… or tap ✨ Write with AI to draft it from the details you entered." />
            </div>
            <div className="rounded-xl border border-line p-3 text-sm">
              <p className="text-base font-semibold text-ink">{name || "Untitled project"}</p>
              <p className="text-xs text-muted">{[area, city].filter(Boolean).join(", ") || "No location"}{coords ? " · 📍 mapped" : ""} · {status.replace("_", " ")}{totalFloors ? ` · ${totalFloors} floors` : ""}{isOffPlan ? " · Off-plan" : ""}</p>
              {amenities.length > 0 && <p className="mt-1 text-xs text-slate">{amenities.join(" · ")}</p>}
              <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted">
                <span>{types.length} unit type(s)</span>
                <span>{totalUnits} unit(s)</span>
                {launchDate && <span>starts {launchDate}</span>}
                {completionDate && <span>completes {completionDate}</span>}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between border-t border-line pt-3">
          <button type="button" onClick={step === 0 ? close : back} className="btn-ghost">{step === 0 ? "Cancel" : "← Back"}</button>
          {step < STEPS.length - 1
            ? <button type="button" onClick={next} className="btn-accent">Next →</button>
            : <button type="button" onClick={submit} disabled={pending} className="btn-accent">{pending ? "Creating…" : "Create project"}</button>}
        </div>
      </Drawer>
    </>
  );
}
