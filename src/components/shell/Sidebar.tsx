"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavItem } from "@/lib/nav";
import { Brand } from "@/components/ui/Brand";

interface SidebarProps {
  items: NavItem[];
  companyName: string;
  roleLabel: string;
  unreadCount?: number;
}

export function Sidebar({ items, companyName, roleLabel, unreadCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop rail

  // Restore + persist desktop collapse via a class on <html> (keeps the main
  // content margin in sync through the --sidebar-w variable).
  useEffect(() => {
    const saved = localStorage.getItem("pz-sidebar-collapsed") === "1";
    setCollapsed(saved);
    document.documentElement.classList.toggle("sidebar-collapsed", saved);
  }, []);

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v;
      document.documentElement.classList.toggle("sidebar-collapsed", next);
      localStorage.setItem("pz-sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  };

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-line bg-paper px-4 py-3 lg:hidden">
        <Brand />
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
          className="rounded-lg border border-line px-3 py-1.5 text-lg text-slate"
        >
          ☰
        </button>
      </div>

      <aside
        className={`${open ? "block" : "hidden"} border-b border-line bg-canvas transition-[width] lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-[var(--sidebar-w)] lg:border-b-0 lg:border-r`}
      >
        <div className="flex h-full flex-col">
          <div className="hidden h-16 items-center px-4 lg:flex">
            <span className="nav-label"><Brand /></span>
            <span className={`${collapsed ? "block" : "hidden"} grid h-8 w-8 place-items-center rounded-lg bg-accent text-base font-bold text-white`}>
              p
            </span>
          </div>

          <div className="nav-label px-4 pb-3 pt-1 lg:pt-0">
            <p className="truncate text-sm font-semibold text-ink">{companyName}</p>
            <p className="truncate text-xs text-muted">{roleLabel}</p>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
            {items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  title={item.label}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-paper font-medium text-accent shadow-[var(--shadow-card)]"
                      : "text-slate hover:bg-subtle hover:text-ink"
                  }`}
                >
                  {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />}
                  <span className={`w-5 text-center text-base ${active ? "text-accent" : "text-muted group-hover:text-slate"}`}>
                    {item.icon}
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {item.href === "/notifications" && unreadCount > 0 && (
                    <span className="nav-label ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-line p-3">
            <button
              onClick={toggleCollapse}
              className="hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-subtle hover:text-ink lg:flex"
            >
              <span className="w-5 text-center text-base">{collapsed ? "»" : "«"}</span>
              <span className="nav-label">Collapse</span>
            </button>
            <form action="/api/signout" method="post">
              <button
                type="submit"
                title="Sign out"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate transition hover:bg-subtle hover:text-danger"
              >
                <span className="w-5 text-center text-base">⏻</span>
                <span className="nav-label">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
