"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";

interface QuickLink {
  label: string;
  href: string;
  icon: IconName;
}

const QUICK_LINKS: QuickLink[] = [
  { label: "Dashboard",   href: "/dashboard",   icon: "dashboard"  },
  { label: "Properties",  href: "/properties",  icon: "home"       },
  { label: "Leads",       href: "/leads",       icon: "target"     },
  { label: "Deals",       href: "/deals",       icon: "exchange"   },
  { label: "Reports",     href: "/reports",     icon: "bar-chart"  },
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
        className="group flex w-full max-w-md items-center gap-2.5 rounded-xl border border-line bg-white/70 px-3.5 py-2.5 text-sm text-muted transition hover:border-accent/40 hover:bg-white hover:text-slate"
      >
        <Icon name="search" className="h-4 w-4" />
        <span className="flex-1 text-left">Search properties, leads, deals…</span>
        <kbd className="kbd">⌘K</kbd>
      </button>

      {open && (
        <div className="pz-fade-up fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-paper shadow-[var(--shadow-pop)]"
            onClick={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={(e) => { e.preventDefault(); go(q); }}
              className="flex items-center gap-3 border-b border-line px-4"
            >
              <Icon name="search" className="h-4 w-4 text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search properties, leads, deals, clients…"
                className="flex-1 bg-transparent py-4 text-sm text-ink outline-none placeholder:text-muted"
              />
              <kbd className="kbd">Esc</kbd>
            </form>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {q.trim() && (
                <button onClick={() => go(q)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-ink hover:bg-accent-wash">
                  <Icon name="search" className="h-4 w-4 text-accent" />
                  Search for “<span className="font-semibold">{q}</span>”
                </button>
              )}

              {recents.length > 0 && (
                <div className="mt-1">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Recent</p>
                  {recents.map((r) => (
                    <button key={r} onClick={() => go(r)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate hover:bg-subtle">
                      <Icon name="refresh" className="h-4 w-4 text-muted" />
                      {r}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-1">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Jump to</p>
                {QUICK_LINKS.map((l) => (
                  <button
                    key={l.href}
                    onClick={() => { setOpen(false); router.push(l.href); }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate hover:bg-subtle hover:text-ink"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-white text-muted">
                      <Icon name={l.icon} className="h-4 w-4" />
                    </span>
                    {l.label}
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
