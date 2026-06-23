"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProject, aiProjectDescription } from "../actions";
import { Drawer } from "@/components/ui/Drawer";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { MapView, type MapMarker } from "@/components/map/MapView";

const STATUSES = ["PLANNING", "PRE_LAUNCH", "SELLING", "SOLD_OUT", "COMPLETED", "ON_HOLD"];
// Mirrors PROJECT_AMENITIES in actions.ts.
const AMENITIES = [
  "Swimming Pool", "Gym", "Parking", "Garage", "Shops / Retail", "Lift / Elevator",
  "Backup Generator", "Security / Guards", "CCTV", "Mosque", "Community Park",
  "Kids Play Area", "Clubhouse", "Rooftop Terrace", "Standby Power", "Water Filtration",
];

export interface EditProjectData {
  id: string;
  name: string;
  status: string;
  city: string;
  area: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  totalFloors: string;
  parkingFloors: string;
  isOffPlan: boolean;
  launchDate: string;
  completionDate: string;
  amenities: string[];
  description: string;
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function EditProject({ project }: { project: EditProjectData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [aiBusy, startAi] = useTransition();

  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState(project.status);
  const [isOffPlan, setIsOffPlan] = useState(project.isOffPlan);
  const [totalFloors, setTotalFloors] = useState(project.totalFloors);
  const [parkingFloors, setParkingFloors] = useState(project.parkingFloors);
  const [launchDate, setLaunchDate] = useState(project.launchDate);
  const [completionDate, setCompletionDate] = useState(project.completionDate);
  const [address, setAddress] = useState(project.address);
  const [city, setCity] = useState(project.city);
  const [area, setArea] = useState(project.area);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    project.latitude != null && project.longitude != null ? { lat: project.latitude, lng: project.longitude } : null,
  );
  const [amenities, setAmenities] = useState<string[]>(project.amenities);
  const [description, setDescription] = useState(project.description);

  const toggleAmenity = (a: string) => setAmenities((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]));
  const marker: MapMarker[] = coords ? [{ id: project.id, title: name || "Project", reference: "", lat: coords.lat, lng: coords.lng, status: "AVAILABLE", price: "", href: "#" }] : [];

  function writeWithAi() {
    setError(null);
    startAi(async () => {
      const r = await aiProjectDescription({
        name: name.trim(), status, city: city.trim(), area: area.trim(), address: address.trim(),
        totalFloors: num(totalFloors), isOffPlan, amenities,
        launchDate: launchDate || undefined, completionDate: completionDate || undefined,
      });
      if (!r.ok) return setError(r.reason);
      setDescription(r.description);
    });
  }

  function save() {
    if (name.trim().length < 2) return setError("Enter a project name.");
    setError(null);
    start(async () => {
      const r = await updateProject({
        id: project.id, name: name.trim(), status: status as "PLANNING",
        city: city.trim() || undefined, area: area.trim() || undefined, address: address.trim() || undefined,
        latitude: coords?.lat ?? null, longitude: coords?.lng ?? null, totalFloors: num(totalFloors), parkingFloors: num(parkingFloors),
        description: description.trim() || undefined, isOffPlan,
        launchDate: launchDate || undefined, completionDate: completionDate || undefined, amenities,
      });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost">Edit</button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Edit project" description={name} width="xl">
        <div className="space-y-5">
          {error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs font-medium text-danger">{error}</p>}

          {/* Details */}
          <div className="space-y-3">
            <div><label className="label" htmlFor="e-name">Project name</label><input id="e-name" className="field text-ink" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label" htmlFor="e-status">Status</label><select id="e-status" className="field text-ink" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
              <div><label className="label" htmlFor="e-floors">Total floors</label><input id="e-floors" type="number" min="0" className="field text-ink" value={totalFloors} onChange={(e) => setTotalFloors(e.target.value)} /></div>
              <div><label className="label" htmlFor="e-park">Parking floors</label><input id="e-park" type="number" min="0" className="field text-ink" value={parkingFloors} onChange={(e) => setParkingFloors(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="e-start">Construction start</label><input id="e-start" type="date" className="field text-ink" value={launchDate} onChange={(e) => setLaunchDate(e.target.value)} /></div>
              <div><label className="label" htmlFor="e-finish">Expected completion</label><input id="e-finish" type="date" className="field text-ink" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" className="h-4 w-4 rounded border-line" checked={isOffPlan} onChange={(e) => setIsOffPlan(e.target.checked)} /> Off-plan (under construction)</label>
          </div>

          {/* Location */}
          <div className="space-y-3 border-t border-line pt-4">
            <div>
              <label className="label">Address / location</label>
              <AddressAutocomplete
                defaultValue={address} defaultLat={coords?.lat ?? null} defaultLon={coords?.lng ?? null}
                placeholder="Start typing — e.g. DHA Phase 8, Karachi"
                onPick={(s) => { setAddress(s.label); setCoords({ lat: s.lat, lng: s.lon }); }}
                onClear={() => setCoords(null)}
              />
              <p className="mt-1 text-xs text-muted">{coords ? `📍 Pinned at ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : "Pick a suggestion to drop a pin on the map."}</p>
            </div>
            {coords && <div className="overflow-hidden rounded-xl border border-line"><MapView markers={marker} height={200} single zoom={15} /></div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="e-city">City</label><input id="e-city" className="field text-ink" value={city} onChange={(e) => setCity(e.target.value)} /></div>
              <div><label className="label" htmlFor="e-area">Area / locality</label><input id="e-area" className="field text-ink" value={area} onChange={(e) => setArea(e.target.value)} /></div>
            </div>
          </div>

          {/* Amenities */}
          <div className="border-t border-line pt-4">
            <label className="label">Amenities</label>
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

          {/* Description */}
          <div className="border-t border-line pt-4">
            <div className="mb-1 flex items-center justify-between">
              <label className="label !mb-0" htmlFor="e-desc">Description</label>
              <button type="button" onClick={writeWithAi} disabled={aiBusy || name.trim().length < 2} className="btn-ghost text-xs text-accent">{aiBusy ? "Writing…" : "✨ Write with AI"}</button>
            </div>
            <textarea id="e-desc" rows={4} className="field text-ink" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the project… or tap ✨ Write with AI." />
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button type="button" onClick={save} disabled={pending} className="btn-accent">{pending ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
