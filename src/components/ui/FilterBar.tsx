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
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {showSearch && (
        <input
          type="search"
          defaultValue={params.get(searchKey) ?? ""}
          placeholder={searchPlaceholder}
          onChange={(e) => update(searchKey, e.target.value)}
          className="field max-w-xs"
        />
      )}
      {filters.map((f) => (
        <select
          key={f.key}
          defaultValue={params.get(f.key) ?? ""}
          onChange={(e) => update(f.key, e.target.value)}
          className="field max-w-[180px]"
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
