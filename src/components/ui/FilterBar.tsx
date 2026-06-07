"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { humanize } from "@/lib/format";

type Option = string | { value: string; label: string };

interface SelectFilter {
  key: string;
  label: string;
  options: readonly Option[];
}

interface FilterBarProps {
  searchKey?: string;
  searchPlaceholder?: string;
  showSearch?: boolean;
  filters?: SelectFilter[];
}

function opt(o: Option): { value: string; label: string } {
  return typeof o === "string" ? { value: o, label: humanize(o) } : o;
}

/**
 * URL-as-state filter bar (web patterns: filters live in the query string so
 * views are shareable). Updating a control replaces the relevant search param.
 */
export function FilterBar({
  searchKey = "q",
  searchPlaceholder = "Search…",
  showSearch = true,
  filters = [],
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      // Filter/search changes invalidate the current page position — drop both
      // the offset page and any keyset cursor so results start from the top.
      next.delete("page");
      next.delete("after");
      next.delete("before");
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-paper/70 p-2 backdrop-blur">
      {showSearch && (
        <div className="relative flex-1 min-w-[14rem] max-w-md">
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            defaultValue={params.get(searchKey) ?? ""}
            placeholder={searchPlaceholder}
            onChange={(e) => update(searchKey, e.target.value)}
            className="field pl-9"
          />
        </div>
      )}
      {filters.map((f) => (
        <select
          key={f.key}
          defaultValue={params.get(f.key) ?? ""}
          onChange={(e) => update(f.key, e.target.value)}
          className="field max-w-[200px]"
          aria-label={f.label}
        >
          <option value="">{f.label}: All</option>
          {f.options.map((o) => {
            const { value, label } = opt(o);
            return (
              <option key={value} value={value}>
                {label}
              </option>
            );
          })}
        </select>
      ))}
    </div>
  );
}
