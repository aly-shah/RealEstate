"use client";

import { useId, useMemo, useState } from "react";
import { PK_CITIES, AREAS_BY_CITY, isKnownCity, suggestedAreas } from "@/lib/pk-areas";

/**
 * Paired City + Area inputs that drop into any form expecting a `city` and
 * `area` field. The city is a select with the six Pakistan-market cities
 * plus "Other" (which falls back to a free-text city input). The area uses
 * a native `<datalist>` for autocomplete — keeps typing flexible (sub-blocks,
 * new localities) while suggesting the catalog.
 *
 *   - `city` and `area` are form-field names — caller controls the keys.
 *   - `defaultCity` / `defaultArea` pre-fill the inputs.
 *   - `required` toggles whether the area input is required.
 */
interface CityAreaPickerProps {
  cityName?: string;
  areaName?: string;
  defaultCity?: string | null;
  defaultArea?: string | null;
  required?: boolean;
}

export function CityAreaPicker({
  cityName = "city",
  areaName = "area",
  defaultCity = null,
  defaultArea = null,
  required = false,
}: CityAreaPickerProps) {
  const datalistId = useId();

  const initialKnown = isKnownCity(defaultCity);
  const [mode, setMode] = useState<"known" | "other">(initialKnown ? "known" : defaultCity ? "other" : "known");
  const [city, setCity] = useState<string>(initialKnown ? (defaultCity as string) : defaultCity ?? "");

  const areas = useMemo(() => suggestedAreas(mode === "known" ? city : null), [mode, city]);

  const onCityChange = (value: string) => {
    if (value === "__other__") {
      setMode("other");
      setCity("");
    } else {
      setMode("known");
      setCity(value);
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor={`${datalistId}-city-select`}>City</label>
        {mode === "known" ? (
          <select
            id={`${datalistId}-city-select`}
            name={cityName}
            value={city}
            onChange={(e) => onCityChange(e.target.value)}
            className="field"
            // City is optional in the schema — match that here.
          >
            <option value="">— Select city —</option>
            {PK_CITIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="__other__">Other (type below)</option>
          </select>
        ) : (
          <div className="flex gap-2">
            <input
              id={`${datalistId}-city-other`}
              name={cityName}
              defaultValue={defaultCity ?? ""}
              className="field flex-1"
              placeholder="City name"
            />
            <button
              type="button"
              onClick={() => { setMode("known"); setCity(""); }}
              className="btn-ghost px-2 py-1.5 text-xs"
              title="Pick from list"
            >
              ←
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="label" htmlFor={`${datalistId}-area-input`}>Area / locality</label>
        <input
          id={`${datalistId}-area-input`}
          name={areaName}
          defaultValue={defaultArea ?? ""}
          list={`${datalistId}-areas`}
          required={required}
          className="field"
          autoComplete="off"
          placeholder={
            mode === "known" && city
              ? `e.g. ${(AREAS_BY_CITY[city as keyof typeof AREAS_BY_CITY] ?? [])[0] ?? "any locality"}`
              : "Type or pick a locality"
          }
        />
        <datalist id={`${datalistId}-areas`}>
          {areas.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
