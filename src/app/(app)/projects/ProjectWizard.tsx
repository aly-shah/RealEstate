"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProjectFull, type ProjectWizardInput } from "./actions";
import { Drawer } from "@/components/ui/Drawer";
import { money } from "@/lib/format";

const STATUSES = ["PLANNING", "PRE_LAUNCH", "SELLING", "SOLD_OUT", "COMPLETED", "ON_HOLD"];
const AREA_UNITS = ["SQFT", "SQYD", "SQM", "MARLA", "KANAL"];
const STEPS = ["Details", "Unit types", "Inventory", "Review"];

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

  // Step 1
  const [name, setName] = useState("");
  const [status, setStatus] = useState("PLANNING");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");
  const [isOffPlan, setIsOffPlan] = useState(false);
  const [launchDate, setLaunchDate] = useState("");
  // Step 2 / 3
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);

  function reset() {
    setStep(0); setError(null);
    setName(""); setStatus("PLANNING"); setCity(""); setArea(""); setDescription(""); setIsOffPlan(false); setLaunchDate("");
    setTypes([]); setBatches([]);
  }
  function close() { setOpen(false); }

  const totalUnits = batches.reduce((s, b) => {
    const f = Number(b.floorFrom), t = Number(b.floorTo), u = Number(b.unitsPerFloor);
    return s + (Number.isFinite(f) && Number.isFinite(t) && t >= f ? (t - f + 1) * (u || 0) : 0);
  }, 0);

  function validateStep(): string | null {
    if (step === 0 && name.trim().length < 2) return "Enter a project name.";
    if (step === 1) {
      for (const t of types) {
        if (!t.name.trim()) return "Every unit type needs a name.";
        if (t.basePrice.trim() === "" || Number(t.basePrice) < 0) return `Set a base price for "${t.name || "the type"}".`;
      }
    }
    if (step === 2) {
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
    if (err) { setError(err); return; }
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  function back() { setError(null); setStep((s) => Math.max(0, s - 1)); }

  function submit() {
    const err = validateStep();
    if (err) { setError(err); return; }
    const payload: ProjectWizardInput = {
      name: name.trim(), status: status as ProjectWizardInput["status"],
      city: city.trim() || undefined, area: area.trim() || undefined,
      description: description.trim() || undefined, isOffPlan, launchDate: launchDate || undefined,
      unitTypes: types.map((t) => ({
        key: t.key, name: t.name.trim(),
        bedrooms: num(t.bedrooms), bathrooms: num(t.bathrooms), areaValue: num(t.areaValue),
        areaUnit: t.areaUnit as "SQFT" | "SQM" | "SQYD" | "MARLA" | "KANAL",
        basePrice: Number(t.basePrice), floorRise: Number(t.floorRise || 0),
      })),
      batches: batches.map((b) => ({
        tower: b.tower.trim(), floorFrom: Number(b.floorFrom), floorTo: Number(b.floorTo),
        unitsPerFloor: Number(b.unitsPerFloor), unitTypeKey: b.unitTypeKey,
      })),
    };
    setError(null);
    start(async () => {
      const r = await createProjectFull(payload);
      if (!r.ok) { setError(r.error); return; }
      close();
      router.push(`/projects/${r.projectId}`);
    });
  }

  const typeName = (k: string) => types.find((t) => t.key === k)?.name || "—";

  return (
    <>
      <button onClick={() => { reset(); setOpen(true); }} className="btn-accent">+ New project</button>
      <Drawer open={open} onClose={close} title="New project" description={STEPS[step]} width="xl">
        {/* Stepper */}
        <ol className="mb-5 flex items-center gap-1.5 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-1.5">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${i < step ? "bg-accent text-white" : i === step ? "brand-gradient text-white" : "bg-line-soft text-muted"}`}>{i < step ? "✓" : i + 1}</span>
              <span className={`truncate ${i === step ? "font-semibold text-ink" : "text-muted"}`}>{s}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" />}
            </li>
          ))}
        </ol>

        {error && <p className="mb-3 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>}

        {/* Step 1 — Details */}
        {step === 0 && (
          <div className="space-y-3">
            <div><label className="label" htmlFor="w-name">Project name</label><input id="w-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Skyline Towers" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="w-city">City</label><input id="w-city" className="field" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Karachi" /></div>
              <div><label className="label" htmlFor="w-area">Area</label><input id="w-area" className="field" value={area} onChange={(e) => setArea(e.target.value)} placeholder="DHA Phase 8" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="w-status">Status</label>
                <select id="w-status" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
              </div>
              <div><label className="label" htmlFor="w-launch">Launch date</label><input id="w-launch" type="date" className="field" value={launchDate} onChange={(e) => setLaunchDate(e.target.value)} /></div>
            </div>
            <div><label className="label" htmlFor="w-desc">Description</label><textarea id="w-desc" rows={2} className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Overview shown to dealers/buyers." /></div>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4 rounded border-line" checked={isOffPlan} onChange={(e) => setIsOffPlan(e.target.checked)} /> Off-plan (under construction)</label>
          </div>
        )}

        {/* Step 2 — Unit types */}
        {step === 1 && (
          <div className="space-y-2">
            <p className="text-xs text-muted">Define the layouts and their pricing. You can add inventory next, or skip and do it later.</p>
            {types.map((t, i) => (
              <div key={t.key} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted">Type {i + 1}</span>
                  <button type="button" onClick={() => setTypes((r) => r.filter((_, j) => j !== i))} className="text-xs text-danger">Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <input className="field" placeholder="Name (2-Bed)" value={t.name} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <input className="field" type="number" min="0" placeholder="Beds" value={t.bedrooms} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, bedrooms: e.target.value } : x))} />
                  <input className="field" type="number" min="0" placeholder="Baths" value={t.bathrooms} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, bathrooms: e.target.value } : x))} />
                  <div className="flex gap-1">
                    <input className="field" type="number" min="0" placeholder="Area" value={t.areaValue} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, areaValue: e.target.value } : x))} />
                    <select className="field !w-24" value={t.areaUnit} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, areaUnit: e.target.value } : x))}>{AREA_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
                  </div>
                  <input className="field" type="number" min="0" placeholder="Base price (PKR)" value={t.basePrice} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, basePrice: e.target.value } : x))} />
                  <input className="field" type="number" min="0" placeholder="Floor rise / floor" value={t.floorRise} onChange={(e) => setTypes((r) => r.map((x, j) => j === i ? { ...x, floorRise: e.target.value } : x))} />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setTypes((r) => [...r, { key: newKey(), name: "", bedrooms: "", bathrooms: "", areaValue: "", areaUnit: "SQFT", basePrice: "", floorRise: "" }])} className="btn-ghost text-xs">+ Add unit type</button>
          </div>
        )}

        {/* Step 3 — Inventory */}
        {step === 2 && (
          <div className="space-y-2">
            {types.length === 0 ? (
              <p className="rounded-lg border border-line bg-canvas/50 px-3 py-2 text-xs text-muted">Add a unit type first to generate inventory — or skip this step and do it on the project page.</p>
            ) : (
              <>
                <p className="text-xs text-muted">Each row generates a tower of one type: price = base + (floor − 1) × floor rise.</p>
                {batches.map((b, i) => (
                  <div key={b.key} className="grid grid-cols-2 gap-2 rounded-xl border border-line p-3 sm:grid-cols-6">
                    <input className="field" placeholder="Tower (A)" value={b.tower} onChange={(e) => setBatches((r) => r.map((x, j) => j === i ? { ...x, tower: e.target.value } : x))} />
                    <input className="field" type="number" placeholder="Floor from" value={b.floorFrom} onChange={(e) => setBatches((r) => r.map((x, j) => j === i ? { ...x, floorFrom: e.target.value } : x))} />
                    <input className="field" type="number" placeholder="Floor to" value={b.floorTo} onChange={(e) => setBatches((r) => r.map((x, j) => j === i ? { ...x, floorTo: e.target.value } : x))} />
                    <input className="field" type="number" min="1" placeholder="Per floor" value={b.unitsPerFloor} onChange={(e) => setBatches((r) => r.map((x, j) => j === i ? { ...x, unitsPerFloor: e.target.value } : x))} />
                    <select className="field" value={b.unitTypeKey} onChange={(e) => setBatches((r) => r.map((x, j) => j === i ? { ...x, unitTypeKey: e.target.value } : x))}>
                      <option value="">Type…</option>
                      {types.map((t) => <option key={t.key} value={t.key}>{t.name || "Unnamed"}</option>)}
                    </select>
                    <button type="button" onClick={() => setBatches((r) => r.filter((_, j) => j !== i))} className="btn-ghost !px-2 text-danger">✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => setBatches((r) => [...r, { key: newKey(), tower: "", floorFrom: "1", floorTo: "10", unitsPerFloor: "4", unitTypeKey: types[0]?.key ?? "" }])} className="btn-ghost text-xs">+ Add tower</button>
                {totalUnits > 0 && <p className="text-xs font-medium text-accent">{totalUnits} unit(s) will be generated.</p>}
              </>
            )}
          </div>
        )}

        {/* Step 4 — Review */}
        {step === 3 && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-line p-3">
              <p className="text-base font-semibold text-ink">{name || "Untitled project"}</p>
              <p className="text-xs text-muted">{[area, city].filter(Boolean).join(", ") || "No location"} · {status.replace("_", " ")}{isOffPlan ? " · Off-plan" : ""}{launchDate ? ` · launches ${launchDate}` : ""}</p>
            </div>
            <div className="rounded-xl border border-line p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Unit types ({types.length})</p>
              {types.length === 0 ? <p className="text-muted">None — add them later.</p> : (
                <ul className="space-y-0.5">{types.map((t) => <li key={t.key} className="flex justify-between"><span>{t.name || "Unnamed"}</span><span className="text-muted">{t.basePrice ? money(Number(t.basePrice)) : "—"}{Number(t.floorRise) ? ` +${money(Number(t.floorRise))}/fl` : ""}</span></li>)}</ul>
              )}
            </div>
            <div className="rounded-xl border border-line p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Inventory</p>
              {batches.length === 0 ? <p className="text-muted">None — generate units later.</p> : (
                <ul className="space-y-0.5">{batches.map((b) => <li key={b.key} className="flex justify-between"><span>Tower {b.tower.toUpperCase()} · floors {b.floorFrom}–{b.floorTo} · {b.unitsPerFloor}/floor</span><span className="text-muted">{typeName(b.unitTypeKey)}</span></li>)}</ul>
              )}
              {totalUnits > 0 && <p className="mt-1 text-xs font-medium text-accent">{totalUnits} unit(s) total</p>}
            </div>
          </div>
        )}

        {/* Footer nav */}
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
