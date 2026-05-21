"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const QUICK_LINKS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Properties", href: "/properties" },
  { label: "Leads", href: "/leads" },
  { label: "Deals", href: "/deals" },
  { label: "Reports", href: "/reports" },
];

const RECENTS_KEY = "pz-recent-searches";

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"));
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const go = (term: string) => {
    const t = term.trim();
    if (!t) return;
    const next = [t, ...recents.filter((r) => r !== t)].slice(0, 5);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    setOpen(false);
    setQ("");
    router.push(`/search?q=${encodeURIComponent(t)}`);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full max-w-md items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-2 text-sm text-muted transition hover:border-accent/40"
      >
        <span aria-hidden>⌕</span>
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-line bg-white px-1.5 py-0.5 text-[11px] font-medium text-muted">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-paper shadow-[var(--shadow-pop)]"
            onClick={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={(e) => { e.preventDefault(); go(q); }}
              className="flex items-center gap-2 border-b border-line px-4"
            >
              <span className="text-muted" aria-hidden>⌕</span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search properties, leads, deals, clients…"
                className="flex-1 bg-transparent py-3.5 text-sm text-ink outline-none placeholder:text-muted"
              />
              <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
            </form>

            <div className="max-h-80 overflow-y-auto p-2">
              {q.trim() && (
                <button onClick={() => go(q)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-subtle">
                  <span className="text-muted">↳</span> Search for “<span className="font-medium">{q}</span>”
                </button>
              )}

              {recents.length > 0 && (
                <div className="mt-1">
                  <p className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">Recent</p>
                  {recents.map((r) => (
                    <button key={r} onClick={() => go(r)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate hover:bg-subtle">
                      <span className="text-muted">↺</span> {r}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-1">
                <p className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">Jump to</p>
                {QUICK_LINKS.map((l) => (
                  <button
                    key={l.href}
                    onClick={() => { setOpen(false); router.push(l.href); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate hover:bg-subtle"
                  >
                    <span className="text-muted">→</span> {l.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
