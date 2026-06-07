"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface View {
  name: string;
  /** Serialised query string ("status=AVAILABLE&type=APARTMENT"). */
  query: string;
}

/**
 * Per-route saved views, backed by localStorage. Three operations:
 *   - SAVE the current filter set under a name
 *   - APPLY a saved view (router.push with its query string)
 *   - DELETE a saved view
 *
 * Storage key is per-pathname so /leads, /properties etc. each keep their own
 * preset list. Cap at 12 views per route — past that, savings become noise.
 *
 * Why localStorage not DB: zero backend cost, instant UX, per-user-per-browser
 * (which matches the "this is *my* shortcut" mental model). Phase 8's white-
 * label work can promote this to a real Saved-Views model if cross-device
 * sync becomes a request.
 */
const MAX_VIEWS = 12;
const storageKey = (pathname: string) => `pz-views:${pathname}`;

export function SavedViews() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  const [views, setViews] = useState<View[]>([]);
  const [open, setOpen] = useState(false);

  // Hydrate once on mount. The list is small (≤12), so JSON-parsing on every
  // open is cheap; we cache in state to keep renders fast.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(pathname));
      setViews(raw ? (JSON.parse(raw) as View[]) : []);
    } catch {
      setViews([]);
    }
  }, [pathname]);

  // Strip pagination from the saved query — Page X of an old filter set
  // rarely matters, and dropping it makes "saved view" mean "saved filters".
  // Covers both offset (page) and keyset (after/before) cursors.
  const currentQuery = (() => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    next.delete("pageSize");
    next.delete("after");
    next.delete("before");
    return next.toString();
  })();

  const persist = (next: View[]) => {
    setViews(next);
    try {
      localStorage.setItem(storageKey(pathname), JSON.stringify(next));
    } catch {
      /* quota errors / private mode — silent */
    }
  };

  const saveCurrent = () => {
    if (!currentQuery) {
      alert("No filters to save. Pick a status / type / search first.");
      return;
    }
    const name = prompt("Save this filter set as:")?.trim();
    if (!name) return;
    const existing = views.findIndex((v) => v.name.toLowerCase() === name.toLowerCase());
    const view: View = { name, query: currentQuery };
    const next =
      existing >= 0
        ? views.map((v, i) => (i === existing ? view : v))
        : [view, ...views].slice(0, MAX_VIEWS);
    persist(next);
  };

  const apply = (view: View) => {
    router.replace(`${pathname}?${view.query}`);
    setOpen(false);
  };

  const remove = (name: string) => {
    persist(views.filter((v) => v.name !== name));
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost px-3 py-1.5 text-xs"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        ★ Views {views.length > 0 && <span className="ms-1 text-muted">· {views.length}</span>}
      </button>

      {open && (
        <div
          className="pz-fade-up absolute end-0 z-20 mt-1.5 w-72 overflow-hidden rounded-xl border border-line bg-paper shadow-[var(--shadow-pop)]"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            onClick={saveCurrent}
            className="flex w-full items-center justify-between border-b border-line bg-canvas/60 px-3 py-2 text-start text-xs hover:bg-line-soft"
          >
            <span className="font-medium text-ink">+ Save current filters</span>
            <span className="text-muted">{currentQuery ? "Save…" : "No filters"}</span>
          </button>

          {views.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted">
              No saved views yet. Apply some filters then click <em>+ Save current filters</em>.
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {views.map((v) => (
                <li key={v.name} className="flex items-center gap-1 px-1">
                  <button
                    onClick={() => apply(v)}
                    className="flex-1 truncate rounded-md px-3 py-1.5 text-start text-sm text-ink hover:bg-line-soft"
                    title={v.query}
                  >
                    {v.name}
                  </button>
                  <button
                    onClick={() => remove(v.name)}
                    className="rounded-md px-2 py-1 text-xs text-muted hover:text-danger"
                    aria-label={`Delete ${v.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
