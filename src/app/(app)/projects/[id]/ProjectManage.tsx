"use client";

import { useActionState, useState, useTransition } from "react";
import { addUnitType, allocateTower, generateUnits, updateProjectStatus, type FormState } from "../actions";
import { humanize } from "@/lib/format";
import { Drawer } from "@/components/ui/Drawer";

const STATUSES = ["PLANNING", "PRE_LAUNCH", "SELLING", "SOLD_OUT", "COMPLETED", "ON_HOLD"];
const AREA_UNITS = ["SQFT", "SQYD", "SQM", "MARLA", "KANAL"];

interface Props {
  projectId: string;
  status: string;
  unitTypes: { id: string; name: string }[];
  hasTypes: boolean;
  dealers: { id: string; name: string }[];
  towers: string[];
}

export function ProjectManage({ projectId, status, unitTypes, hasTypes, dealers, towers }: Props) {
  const [typeOpen, setTypeOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [allocOpen, setAllocOpen] = useState(false);
  const [statusPending, startStatus] = useTransition();

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
      <button onClick={() => setTypeOpen(true)} className="btn-ghost">+ Unit type</button>
      <button onClick={() => setAllocOpen(true)} className="btn-ghost" disabled={towers.length === 0 || dealers.length === 0} title={dealers.length === 0 ? "Add a dealer first" : towers.length === 0 ? "Generate units first" : ""}>Allocate</button>
      <button onClick={() => setGenOpen(true)} className="btn-accent" disabled={!hasTypes} title={hasTypes ? "" : "Add a unit type first"}>Generate units</button>

      {/* Add unit type */}
      <Drawer open={typeOpen} onClose={() => setTypeOpen(false)} title="Add unit type" description="A layout + its base price." width="md">
        <form action={typeAction} className="space-y-3">
          <input type="hidden" name="projectId" value={projectId} />
          {typeState.error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{typeState.error}</p>}
          <div>
            <label className="label" htmlFor="t-name">Name</label>
            <input id="t-name" name="name" className="field" placeholder="e.g. 2-Bed" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="t-beds">Bedrooms</label><input id="t-beds" name="bedrooms" type="number" min="0" className="field" /></div>
            <div><label className="label" htmlFor="t-baths">Bathrooms</label><input id="t-baths" name="bathrooms" type="number" min="0" className="field" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="t-area">Area</label><input id="t-area" name="areaValue" type="number" min="0" step="any" className="field" /></div>
            <div>
              <label className="label" htmlFor="t-areaunit">Unit</label>
              <select id="t-areaunit" name="areaUnit" className="field" defaultValue="SQFT">
                {AREA_UNITS.map((u) => <option key={u} value={u}>{humanize(u)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="t-base">Base price (PKR)</label>
              <input id="t-base" name="basePrice" type="number" min="0" className="field" required />
            </div>
            <div>
              <label className="label" htmlFor="t-rise">Floor rise / floor</label>
              <input id="t-rise" name="floorRise" type="number" min="0" className="field" placeholder="0" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setTypeOpen(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={typePending} className="btn-accent">{typePending ? "Saving…" : "Add type"}</button>
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
