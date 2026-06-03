"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * URL-state date-range filter for the reports page. The two query params
 * (`from`, `to`) are ISO date strings (YYYY-MM-DD); the server reads them
 * with `parseDateRange()` from lib/reports.
 *
 * Five presets cover the operational cases owners ask for:
 *   - This month (default)
 *   - Last month
 *   - Last 90 days
 *   - This quarter (calendar Q based on UTC)
 *   - Year to date
 * Plus a manual from/to picker for arbitrary windows.
 */

interface DateRangeFilterProps {
  defaultFrom: string;
  defaultTo: string;
}

type Preset = { id: string; label: string; range: () => { from: string; to: string } };

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

const PRESETS: Preset[] = [
  {
    id: "this-month",
    label: "This month",
    range: () => ({ from: iso(startOfMonth()), to: iso(new Date()) }),
  },
  {
    id: "last-month",
    label: "Last month",
    range: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = endOfMonth(start);
      return { from: iso(start), to: iso(end) };
    },
  },
  {
    id: "last-90",
    label: "Last 90 days",
    range: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 89);
      return { from: iso(from), to: iso(to) };
    },
  },
  {
    id: "this-quarter",
    label: "This quarter",
    range: () => {
      const now = new Date();
      const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      return { from: iso(qStart), to: iso(now) };
    },
  },
  {
    id: "ytd",
    label: "Year to date",
    range: () => ({ from: iso(new Date(new Date().getFullYear(), 0, 1)), to: iso(new Date()) }),
  },
];

export function DateRangeFilter({ defaultFrom, defaultTo }: DateRangeFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const apply = useCallback(
    (from: string, to: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("from", from);
      next.set("to", to);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  // The "currently active" preset is the one whose computed range matches
  // the URL exactly — used to highlight the chip without storing extra state.
  const activeId = (() => {
    const f = params.get("from") ?? defaultFrom;
    const t = params.get("to") ?? defaultTo;
    for (const p of PRESETS) {
      const r = p.range();
      if (r.from === f && r.to === t) return p.id;
    }
    return null;
  })();

  return (
    <div className="surface flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              const r = p.range();
              apply(r.from, r.to);
            }}
            className={`chip transition ${
              activeId === p.id
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-slate hover:border-accent/40 hover:text-accent"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted">
        <span>or</span>
        <label className="flex items-center gap-1.5">
          From
          <input
            type="date"
            defaultValue={defaultFrom}
            onChange={(e) => apply(e.target.value, params.get("to") ?? defaultTo)}
            className="field max-w-[150px] py-1 text-xs"
          />
        </label>
        <label className="flex items-center gap-1.5">
          to
          <input
            type="date"
            defaultValue={defaultTo}
            onChange={(e) => apply(params.get("from") ?? defaultFrom, e.target.value)}
            className="field max-w-[150px] py-1 text-xs"
          />
        </label>
      </div>
    </div>
  );
}
