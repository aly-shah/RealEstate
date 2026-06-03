"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { PAGE_SIZE_OPTIONS } from "@/lib/pagination";

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
}

/**
 * URL-as-state pagination — sits below any list/table. Preserves all current
 * search params (filters, search query) when navigating between pages.
 */
export function Pagination({ total, page, pageSize }: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  if (total <= PAGE_SIZE_OPTIONS[0] && page === 1) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paper/70 px-3 py-2 backdrop-blur">
      <p className="text-xs text-muted">
        {total === 0
          ? "No results"
          : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
      </p>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted">
          Per page
          <select
            value={pageSize}
            onChange={(e) => update({ pageSize: e.target.value, page: null })}
            className="field ms-2 inline-block w-[88px] py-1.5 text-xs"
            aria-label="Page size"
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => update({ page: String(page - 1) })}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          ← Prev
        </button>
        <span className="text-xs text-muted">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => update({ page: String(page + 1) })}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
