"use client";

import { useState, useTransition } from "react";
import { updateUnit, deleteUnit, unitMedia, addUnitMedia, deleteUnitMedia, type MediaItem } from "../actions";
import { Drawer } from "@/components/ui/Drawer";
import { MediaManager } from "./MediaManager";

const STATUSES = ["AVAILABLE", "RESERVED", "SOLD", "INACTIVE"];

interface Unit { id: string; reference: string; salePrice: number; status: string }

/** Row controls for a project unit — quick-edit price/status, manage photos/floor plans, or delete. */
export function UnitActions({ unit }: { unit: Unit }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(String(unit.salePrice || ""));
  const [status, setStatus] = useState(unit.status);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  function openEdit() {
    setPrice(String(unit.salePrice || "")); setStatus(unit.status); setError(null); setMedia(null); setOpen(true);
    unitMedia(unit.id).then(setMedia).catch(() => setMedia([]));
  }

  function save() {
    setError(null);
    startSave(async () => {
      const r = await updateUnit({ unitId: unit.id, salePrice: Number(price || 0), status: status as "AVAILABLE" });
      if (!r.ok) { setError(r.error); return; }
      setOpen(false);
    });
  }

  function remove() {
    if (!window.confirm(`Delete unit ${unit.reference}? This can't be undone.`)) return;
    setError(null);
    startDelete(async () => {
      const r = await deleteUnit(unit.id);
      if (!r.ok) window.alert(r.error);
    });
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <button type="button" onClick={openEdit} className="btn-ghost !px-2 !py-1 text-xs">Edit</button>
      <button type="button" onClick={remove} disabled={deleting} className="btn-ghost !px-2 !py-1 text-xs text-danger">{deleting ? "…" : "Delete"}</button>

      <Drawer open={open} onClose={() => setOpen(false)} title={`Edit ${unit.reference}`} description="Price, status, and photos / floor plans." width="md">
        <div className="space-y-4">
          {error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs font-medium text-danger">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="u-price">Price (PKR)</label>
              <input id="u-price" type="number" min="0" className="field text-ink" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="u-status">Status</label>
              <select id="u-status" className="field text-ink" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={save} disabled={saving} className="btn-accent">{saving ? "Saving…" : "Save price & status"}</button>
          </div>

          <div className="border-t border-line pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Photos & floor plans</p>
            {media === null ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <MediaManager items={media} onAdd={(i) => addUnitMedia({ unitId: unit.id, ...i })} onRemove={deleteUnitMedia} />
            )}
          </div>
        </div>
      </Drawer>
    </div>
  );
}
