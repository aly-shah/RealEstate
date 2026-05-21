"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { initials } from "@/lib/format";

interface UserMenuProps {
  name: string;
  roleLabel: string;
  canManage: boolean;
}

export function UserMenu({ name, roleLabel, canManage }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 transition hover:bg-subtle"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-semibold text-white">
          {initials(name)}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight text-ink">{name}</span>
          <span className="block text-xs leading-tight text-muted">{roleLabel}</span>
        </span>
        <span className="text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-paper py-1 shadow-[var(--shadow-pop)]">
          <div className="border-b border-line px-3 py-2 sm:hidden">
            <p className="text-sm font-medium text-ink">{name}</p>
            <p className="text-xs text-muted">{roleLabel}</p>
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-slate hover:bg-subtle">
            Notifications
          </Link>
          {canManage && (
            <Link href="/settings" onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-slate hover:bg-subtle">
              Settings
            </Link>
          )}
          <form action="/api/signout" method="post" className="border-t border-line">
            <button type="submit" className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-subtle">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
