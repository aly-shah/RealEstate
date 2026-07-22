"use client";

import { useActionState, useState } from "react";
import { setPropertyAmenities, type FormState } from "@/app/(app)/properties/actions";
import { AMENITY_GROUPS } from "@/lib/amenities";

/**
 * Standalone amenities editor for the property detail page. Read-only chips for
 * users without manage rights; an inline toggle-and-save picker for those who
 * can. Saving goes through the setPropertyAmenities action, which revalidates
 * the public share page too — so amenities appear there right away.
 */
export function PropertyAmenities({
  propertyId,
  initial,
  canManage,
}: {
  propertyId: string;
  initial: string[];
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [state, action, pending] = useActionState<FormState, FormData>(
    async (p, fd) => setPropertyAmenities(p, fd),
    {},
  );

  const toggle = (a: string) =>
    setSelected((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  const dirty =
    selected.length !== initial.length || selected.some((a) => !initial.includes(a));

  // Read-only view for users who can't manage properties.
  if (!canManage) {
    if (selected.length === 0) return <p className="text-sm text-muted">No amenities listed.</p>;
    return (
      <div className="flex flex-wrap gap-2">
        {selected.map((a) => (
          <span key={a} className="rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-slate">
            {a}
          </span>
        ))}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="amenities" value={selected.join(",")} />

      <div className="space-y-4">
        {AMENITY_GROUPS.map((group) => (
          <div key={group.category}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted/80">{group.category}</p>
            <div className="flex flex-wrap gap-2">
              {group.items.map((a) => {
                const on = selected.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggle(a)}
                    aria-pressed={on}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      on
                        ? "border-slate-800 bg-slate-800 text-white"
                        : "border-line bg-paper text-muted hover:border-slate-400 hover:text-ink"
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

      <div className="flex items-center gap-3">
        <button type="submit" disabled={!dirty || pending} className="btn-primary text-sm disabled:opacity-50">
          {pending ? "Saving…" : "Save amenities"}
        </button>
        <span className="text-xs text-muted">{selected.length} selected</span>
        {state.ok && !dirty && <span className="text-xs text-ok">✓ Saved</span>}
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
