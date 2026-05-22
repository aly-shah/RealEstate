"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { initials } from "@/lib/format";
import { Icon } from "@/components/ui/Icon";
import type { Dict } from "@/lib/i18n/dictionary";

interface UserMenuProps {
  name: string;
  roleLabel: string;
  canManage: boolean;
  dict: Dict;
}

export function UserMenu({ name, roleLabel, canManage, dict }: UserMenuProps) {
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
        className="flex items-center gap-2.5 rounded-xl border border-transparent px-1.5 py-1 transition hover:bg-subtle"
      >
        <span
          className="grid h-9 w-9 place-items-center rounded-full bg-accent text-xs font-semibold text-white shadow-[var(--shadow-card)]"
          style={{ backgroundImage: "var(--gradient-brand)" }}
        >
          {initials(name)}
        </span>
        <span className="hidden text-start sm:block">
          <span className="block text-sm font-medium leading-tight text-ink">{name}</span>
          <span className="block text-xs leading-tight text-muted">{roleLabel}</span>
        </span>
        <Icon name="chevron-down" className="h-4 w-4 text-muted" />
      </button>

      {open && (
        <div className="pz-fade-up absolute end-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-line bg-paper p-1 shadow-[var(--shadow-pop)]">
          <div className="border-b border-line px-3 py-2.5">
            <p className="text-sm font-semibold text-ink">{name}</p>
            <p className="text-xs text-muted">{roleLabel}</p>
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-slate hover:bg-subtle hover:text-ink">
            {dict.nav.notifications}
          </Link>
          {canManage && (
            <Link href="/settings" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-slate hover:bg-subtle hover:text-ink">
              {dict.nav.settings}
            </Link>
          )}
          <form action="/api/signout" method="post" className="border-t border-line pt-1 mt-1">
            <button type="submit" className="block w-full rounded-lg px-3 py-2 text-start text-sm text-danger hover:bg-danger/10">
              {dict.shell.signOut}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
