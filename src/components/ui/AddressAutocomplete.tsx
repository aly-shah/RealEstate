"use client";

import { useEffect, useId, useRef, useState } from "react";

interface Suggestion {
  label: string;
  lat: number;
  lon: number;
}

interface AddressAutocompleteProps {
  /** Form field name for the address text. */
  name?: string;
  /** Field names for the captured coordinates (submitted as hidden inputs). */
  latName?: string;
  lonName?: string;
  defaultValue?: string;
  /** Pre-captured coordinates (edit mode) — preserved until the user retypes. */
  defaultLat?: number | null;
  defaultLon?: number | null;
  placeholder?: string;
}

/** Build a readable one-line label from a Photon GeoJSON feature. */
function toSuggestion(f: {
  properties?: Record<string, string>;
  geometry?: { coordinates?: [number, number] };
}): Suggestion | null {
  const p = f.properties ?? {};
  const c = f.geometry?.coordinates;
  if (!c || c.length < 2) return null;
  const street = p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street;
  const parts = [p.name, street, p.district, p.city, p.county, p.state, p.country].filter(Boolean) as string[];
  const label = [...new Set(parts)].join(", ");
  return { label: label || p.name || "Unknown place", lat: c[1], lon: c[0] };
}

/**
 * Address input with OpenStreetMap-powered suggestions (Photon — keyless, CORS,
 * built for type-ahead). Picking a suggestion fills the address and captures
 * lat/long into hidden fields, so the new property lands on the map. Manual
 * editing clears the captured coordinates (they'd be stale). Degrades to a
 * plain text input if the geocoder is unreachable.
 *
 * Results are proximity-biased to Pakistan but not restricted, so an
 * international listing still works.
 */
export function AddressAutocomplete({
  name = "address",
  latName = "latitude",
  lonName = "longitude",
  defaultValue = "",
  defaultLat = null,
  defaultLon = null,
  placeholder = "Start typing an address…",
}: AddressAutocompleteProps) {
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(
    defaultLat != null && defaultLon != null ? { lat: defaultLat, lon: defaultLon } : null,
  );
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listId = useId();

  useEffect(() => {
    const q = value.trim();
    // Debounced geocode. All state updates live inside the timeout callback so
    // none run synchronously in the effect body.
    const t = setTimeout(async () => {
      if (q.length < 3 || coords) {
        setItems([]);
        setOpen(false);
        return;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      try {
        // Pakistan-only. A bounding box can't separate PK from India (shared
        // border — Delhi falls inside any PK-covering box), so the hard filter
        // is countrycode === "PK". Over-fetch (limit 10) + proximity-bias to
        // Pakistan so enough PK results remain after filtering, then show 6.
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&lat=30.3753&lon=69.3451`;
        const res = await fetch(url, { signal: ac.signal });
        const data = (await res.json()) as { features?: Parameters<typeof toSuggestion>[0][] };
        const next = (data.features ?? [])
          .filter((f) => f.properties?.countrycode === "PK")
          .map(toSuggestion)
          .filter((s): s is Suggestion => s !== null)
          .slice(0, 6);
        setItems(next);
        setOpen(next.length > 0);
        setActive(-1);
      } catch {
        /* aborted or offline — keep the plain input working */
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [value, coords]);

  function onType(v: string) {
    setValue(v);
    setCoords(null); // coordinates no longer match the edited text
  }

  function pick(s: Suggestion) {
    setValue(s.label);
    setCoords({ lat: s.lat, lon: s.lon });
    setItems([]);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        name={name}
        value={value}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => items.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        className="field"
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      <input type="hidden" name={latName} value={coords?.lat ?? ""} />
      <input type="hidden" name={lonName} value={coords?.lon ?? ""} />

      {loading && !open && <span className="absolute end-3 top-2.5 text-xs text-muted">…</span>}

      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-paper py-1 shadow-[var(--shadow-pop)]">
          {items.map((s, i) => (
            <li key={`${s.lat},${s.lon},${i}`}>
              <button
                type="button"
                // preventDefault keeps the input from blurring before the click lands
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-start text-sm ${
                  i === active ? "bg-line-soft text-ink" : "text-ink hover:bg-line-soft"
                }`}
              >
                <span className="mt-0.5 shrink-0 text-muted" aria-hidden>📍</span>
                <span className="truncate">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {coords && (
        <p className="mt-1 text-xs text-success">Location pinned — this property will show on the map.</p>
      )}
    </div>
  );
}
