"use client";

import { useActionState, useState, useTransition } from "react";
import { addUnitType, allocateTower, generateUnits, updateProjectStatus, type FormState } from "../actions";
import { humanize } from "@/lib/format";
import { Drawer } from "@/components/ui/Drawer";

const STATUSES = ["PLANNING", "PRE_LAUNCH", "SELLING", "SOLD_OUT", "COMPLETED", "ON_HOLD"];
const AREA_UNITS = ["SQFT", "SQYD", "SQM", "MARLA", "KANAL"];
const lbl = "mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted";

interface Props {
  projectId: string;
  status: string;
  unitTypes: { id: string; name: string }[];
  hasTypes: boolean;
  dealers: { id: string; name: string }[];
  towers: string[];
  totalFloors: number | null;
  parkingFloors: number | null;
}

export function ProjectManage({ projectId, status, unitTypes, hasTypes, dealers, towers, totalFloors, parkingFloors }: Props) {
  const [typeOpen, setTypeOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [allocOpen, setAllocOpen] = useState(false);
  const [statusPending, startStatus] = useTransition();

  // Apartment floor range (parking+1 … total) — pre-fills the placement fields.
  const apartFrom = (parkingFloors ?? 0) + 1;
  const [pFrom, setPFrom] = useState(totalFloors ? String(apartFrom) : "");
  const [pTo, setPTo] = useState(totalFloors ? String(totalFloors) : "");
  const [pPer, setPPer] = useState("");
  const placeCount = (() => {
    const f = Number(pFrom), t = Number(pTo), u = Number(pPer);
    return pFrom && pTo && pPer && t >= f ? (t - f + 1) * u : 0;
  })();

  const [allocState, allocAction, allocPending] = useActionState<FormState, FormData>(async (p, fd) => {
    const r = await allocateTower(p, fd);
    if (!r.error) setAllocOpen(false);
    return r;
  }, {});

  // Both actions return {} on success; close the drawer when there's no error.
  const [typeState, typeAction, typePending] = useActionState<FormState, FormData>(async (p, fd) => {
    const r = await addUnitType(p, fd);
    if (!r.error) setTypeOpen(false);
    return r;
  }, {});
  const [genState, genAction, genPending] = useActionState<FormState, FormData>(async (p, fd) => {
    const r = await generateUnits(p, fd);
    if (!r.error) setGenOpen(false);
    return r;
  }, {});

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        defaultValue={status}
        disabled={statusPending}
        onChange={(e) => startStatus(() => { updateProjectStatus(projectId, e.target.value); })}
        className="field !w-auto !py-1.5 text-sm"
        aria-label="Project status"
      >
        {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
      </select>
      <button onClick={() => setTypeOpen(true)} className="btn-accent">+ Add unit</button>
      <button onClick={() => setAllocOpen(true)} className="btn-ghost" disabled={towers.length === 0 || dealers.length === 0} title={dealers.length === 0 ? "Add a dealer first" : towers.length === 0 ? "Generate units first" : ""}>Allocate</button>
      <button onClick={() => setGenOpen(true)} className="btn-ghost" disabled={!hasTypes} title={hasTypes ? "" : "Add a unit type first"}>Generate more</button>

      {/* Add unit — layout, price + placement (generates the units in one step) */}
      <Drawer open={typeOpen} onClose={() => setTypeOpen(false)} title="Add unit" description="Define the layout & price, then where it sits — its units are generated for you." width="lg">
        <form action={typeAction} className="space-y-4">
          <input type="hidden" name="projectId" value={projectId} />
          {typeState.error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs font-medium text-danger">{typeState.error}</p>}

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Layout & price</p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-6">
              <div className="sm:col-span-2"><label className={lbl}>Name</label><input name="name" className="field text-ink" placeholder="2-Bed" required /></div>
              <div><label className={lbl}>Beds</label><input name="bedrooms" type="number" min="0" className="field text-ink" /></div>
              <div><label className={lbl}>Baths</label><input name="bathrooms" type="number" min="0" className="field text-ink" /></div>
              <div><label className={lbl}>Size</label><input name="areaValue" type="number" min="0" step="any" className="field text-ink" placeholder="1100" /></div>
              <div>
                <label className={lbl}>Unit</label>
                <select name="areaUnit" className="field text-ink" defaultValue="SQFT">{AREA_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
              </div>
              <div className="sm:col-span-3"><label className={lbl}>Base price (PKR)</label><input name="basePrice" type="number" min="0" className="field text-ink" placeholder="20000000" required /></div>
              <div className="sm:col-span-3"><label className={lbl}>Floor rise / floor</label><input name="floorRise" type="number" min="0" className="field text-ink" placeholder="0" /></div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Placement <span className="normal-case text-muted">(optional — fill in to generate units now)</span></p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-4">
              <div><label className={lbl}>Tower / block</label><input name="tower" className="field text-ink" placeholder="A" /></div>
              <div><label className={lbl}>Floor from</label><input name="floorFrom" type="number" className="field text-ink" value={pFrom} onChange={(e) => setPFrom(e.target.value)} /></div>
              <div><label className={lbl}>Floor to</label><input name="floorTo" type="number" className="field text-ink" value={pTo} onChange={(e) => setPTo(e.target.value)} /></div>
              <div><label className={lbl}>Units / floor</label><input name="unitsPerFloor" type="number" min="1" className="field text-ink" value={pPer} onChange={(e) => setPPer(e.target.value)} /></div>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {placeCount > 0
                ? <span className="font-medium text-accent">{placeCount} unit(s) will be generated</span>
                : (totalFloors ? `Apartments go on floors ${apartFrom}–${totalFloors}. Leave blank to add the type without units.` : "Leave placement blank to add the type without generating units.")}
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" onClick={() => setTypeOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={typePending} className="btn-accent">{typePending ? "Saving…" : placeCount > 0 ? `Add + generate ${placeCount}` : "Add unit type"}</button>
          </div>
        </form>
      </Drawer>

      {/* Generate units */}
      <Drawer open={genOpen} onClose={() => setGenOpen(false)} title="Generate units" description="Bulk-create a tower's inventory." width="md">
        <form action={genAction} className="space-y-3">
          <input type="hidden" name="projectId" value={projectId} />
          {genState.error && <p className="rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">{genState.error}</p>}
          <div>
            <label className="label" htmlFor="g-type">Unit type</label>
            <select id="g-type" name="unitTypeId" className="field" required defaultValue="">
              <option value="" disabled>— Pick a type —</option>
              {unitTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="g-tower">Tower / block</label>
            <input id="g-tower" name="tower" className="field" placeholder="e.g. A" required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label" htmlFor="g-from">Floor from</label><input id="g-from" name="floorFrom" type="number" className="field" defaultValue={1} required /></div>
            <div><label className="label" htmlFor="g-to">Floor to</label><input id="g-to" name="floorTo" type="number" className="field" defaultValue={10} required /></div>
            <div><label className="label" htmlFor="g-per">Per floor</label><input id="g-per" name="unitsPerFloor" type="number" min="1" className="field" defaultValue={4} required /></div>
          </div>
          <p className="text-xs text-muted">Price per unit = base price + (floor − 1) × floor rise. References look like <span className="font-mono">PRJ-A-1203</span>; re-running skips units that already exist.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setGenOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={genPending} className="btn-accent">{genPending ? "Generating…" : "Generate"}</button>
          </div>
        </form>
      </Drawer>

      {/* Allocate a tower to a dealer */}
      <Drawer open={allocOpen} onClose={() => setAllocOpen(false)} title="Allocate tower to a dealer" description="Assign a tower's available units to a dealer to sell." width="md">
        <form action={allocAction} className="space-y-3">
          <input type="hidden" name="projectId" value={projectId} />
          {allocState.error && <p className="rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">{allocState.error}</p>}
          <div>
            <label className="label" htmlFor="a-tower">Tower</label>
            <select id="a-tower" name="tower" className="field" required defaultValue="">
              <option value="" disabled>— Pick a tower —</option>
              {towers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="a-dealer">Dealer</label>
            <select id="a-dealer" name="dealerId" className="field" required defaultValue="">
              <option value="" disabled>— Pick a dealer —</option>
              {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              <option value="__unassign__">— Clear allocation —</option>
            </select>
          </div>
          <p className="text-xs text-muted">Only AVAILABLE units are (re)assigned — reserved/sold units keep their dealer.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setAllocOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={allocPending} className="btn-accent">{allocPending ? "Allocating…" : "Allocate"}</button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
