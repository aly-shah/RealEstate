"use client";

import { useActionState, useState } from "react";
import { recordShowing, type FormState } from "./actions";

interface CheckInFormProps {
  properties: { id: string; title: string; reference: string }[];
  clients: { id: string; name: string }[];
}

export function CheckInForm({ properties, clients }: CheckInFormProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<string>("");
  const [state, action, pending] = useActionState<FormState, FormData>(async (p, fd) => {
    const res = await recordShowing(p, fd);
    if (res.ok) {
      setOpen(false);
      setCoords(null);
      setGeoStatus("");
    }
    return res;
  }, {});

  const capture = () => {
    if (!navigator.geolocation) {
      setGeoStatus("Geolocation unavailable — use manual location.");
      return;
    }
    setGeoStatus("Locating…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("Location captured ✓");
      },
      () => setGeoStatus("Couldn't get location — use manual location."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setOpen((v) => !v)} className="btn-accent">{open ? "Close" : "⚑ Record a visit"}</button>
      </div>

      {open && (
        <form action={action} className="surface mb-6 grid gap-4 p-6 sm:grid-cols-2">
          <input type="hidden" name="lat" value={coords?.lat ?? ""} />
          <input type="hidden" name="lng" value={coords?.lng ?? ""} />

          <div>
            <label className="label" htmlFor="propertyId">Property shown</label>
            <select id="propertyId" name="propertyId" className="field" required defaultValue="">
              <option value="" disabled>Select…</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.reference} · {p.title}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" className="field" defaultValue="">
              <option value="">— Not specified —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="label">Location</label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={capture} className="btn-ghost text-xs">📍 Use GPS</button>
              <span className="text-xs text-muted">{geoStatus}{coords ? ` (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})` : ""}</span>
            </div>
            <input name="manualLocation" className="field mt-2" placeholder="Or type the location manually" />
          </div>

          <div>
            <label className="label" htmlFor="interestLevel">Client interest level</label>
            <select id="interestLevel" name="interestLevel" className="field" defaultValue="">
              <option value="">— Not set —</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
              <option value="NONE">None</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="clientFeedback">Client feedback</label>
            <textarea id="clientFeedback" name="clientFeedback" rows={2} className="field" placeholder="How did the client react?" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={2} className="field" />
          </div>

          {state.error && <p className="sm:col-span-2 rounded-lg border border-red-200 bg-danger-bg px-3 py-2 text-sm text-danger">{state.error}</p>}
          <div className="sm:col-span-2">
            <button type="submit" disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save visit"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
