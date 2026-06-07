"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { PAGE_SIZE_OPTIONS } from "@/lib/pagination";

interface KeysetPaginationProps {
  /** Token to page back toward newer rows (null = already at the start). */
  prevCursor: string | null;
  /** Token to page toward older rows (null = no more). */
  nextCursor: string | null;
  pageSize: number;
  /** Rows on the current page (for the "N on this page" hint). */
  count: number;
}

/**
 * Cursor pager for keyset-paginated lists (see lib/pagination.ts). Unlike the
 * offset `Pagination`, it has no total or page numbers — that's the keyset
 * trade-off — but Prev/Next stay O(1) at any depth. Writes `after`/`before`
 * into the URL (mutually exclusive) and preserves the other params (filters,
 * search). Changing page size resets to the first page.
 */
export function KeysetPagination({ prevCursor, nextCursor, pageSize, count }: KeysetPaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = useCallback(
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

  // Single full page with nothing on either side — nothing to show.
  if (!prevCursor && !nextCursor) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paper/70 px-3 py-2 backdrop-blur">
      <p className="text-xs text-muted">{count.toLocaleString()} on this page</p>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted">
          Per page
          <select
            value={pageSize}
            onChange={(e) => go({ pageSize: e.target.value, after: null, before: null })}
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
          disabled={!prevCursor}
          onClick={() => go({ before: prevCursor, after: null })}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          ← Prev
        </button>
        <button
          type="button"
          disabled={!nextCursor}
          onClick={() => go({ after: nextCursor, before: null })}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
