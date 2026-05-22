"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type NavGroup, type NavItem } from "@/lib/nav";
import { Brand } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";
import type { Dict } from "@/lib/i18n/dictionary";

interface SidebarProps {
  items: NavItem[];
  companyName: string;
  roleLabel: string;
  unreadCount?: number;
  dict: Dict;
}

/** Map an `/href` to a nav-label translation key. */
const NAV_KEY: Record<string, keyof Dict["nav"]> = {
  "/dashboard": "dashboard",
  "/properties": "properties",
  "/map": "map",
  "/leads": "leads",
  "/deals": "deals",
  "/calendar": "calendar",
  "/visits": "visits",
  "/commissions": "commissions",
  "/payments": "payments",
  "/agents": "agents",
  "/dealers": "dealers",
  "/documents": "documents",
  "/reports": "reports",
  "/activity": "activityLog",
  "/notifications": "notifications",
  "/settings": "settings",
  "/admin/companies": "companies",
};

function navLabel(item: NavItem, dict: Dict): string {
  const key = NAV_KEY[item.href];
  return key ? dict.nav[key] : item.label;
}

export function Sidebar({ items, companyName, roleLabel, unreadCount = 0, dict }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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

  /** Preserve order while grouping. */
  const grouped = useMemo(() => {
    const out: Array<{ group: NavGroup; items: NavItem[] }> = [];
    for (const item of items) {
      const group = (item.group ?? "workspace") as NavGroup;
      const tail = out[out.length - 1];
      if (tail && tail.group === group) tail.items.push(item);
      else out.push({ group, items: [item] });
    }
    return out;
  }, [items]);

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-line bg-paper/90 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
          className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white text-slate transition hover:border-accent/40 hover:text-accent"
        >
          <Icon name="menu" className="h-5 w-5" />
        </button>
      </div>

      <aside
        className={`${open ? "block" : "hidden"} border-b border-line bg-paper transition-[width] lg:fixed lg:inset-y-0 lg:start-0 lg:z-40 lg:block lg:w-[var(--sidebar-w)] lg:border-b-0 lg:border-e`}
      >
        <div className="flex h-full flex-col">
          {/* Brand row */}
          <div className="hidden h-16 items-center px-4 lg:flex">
            <span className="nav-label"><Brand /></span>
            <span
              className={`${collapsed ? "grid" : "hidden"} h-9 w-9 place-items-center overflow-hidden rounded-xl bg-accent text-white shadow-[var(--shadow-soft)]`}
              style={{ backgroundImage: "var(--gradient-brand)" }}
              aria-hidden
            >
              <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11.2 12 4l9 7.2" />
                <path d="M5.5 10v9.5h13V10" />
                <path d="M10 19.5V14h4v5.5" />
              </svg>
            </span>
          </div>

          {/* Company / role card */}
          <div className="nav-label px-4 pb-3 pt-1 lg:pt-0">
            <div className="rounded-xl border border-line bg-canvas/60 px-3 py-2.5">
              <p className="truncate text-sm font-semibold text-ink">{companyName}</p>
              <p className="truncate text-xs text-muted">{roleLabel}</p>
            </div>
          </div>

          {/* Nav */}
          <nav className="pz-scroll flex-1 space-y-4 overflow-y-auto px-3 pb-4">
            {grouped.map((section, gi) => (
              <div key={`${section.group}-${gi}`}>
                <p className="nav-group-label px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {dict.groups[section.group as keyof Dict["groups"]] ?? section.group}
                </p>
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        title={navLabel(item, dict)}
                        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                          active
                            ? "bg-accent-wash font-semibold text-accent"
                            : "text-slate hover:bg-subtle hover:text-ink"
                        }`}
                      >
                        {active && (
                          <span className="absolute start-0 top-2 bottom-2 w-1 rounded-e-full brand-gradient" />
                        )}
                        <span className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                          active
                            ? "bg-white text-accent shadow-[var(--shadow-card)]"
                            : "text-muted group-hover:text-slate"
                        }`}>
                          <Icon name={item.icon} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="nav-label flex-1 truncate">{navLabel(item, dict)}</span>
                        {item.href === "/notifications" && unreadCount > 0 && (
                          <span className="nav-label ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">
                            {unreadCount > 9 ? "9+" : unreadCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-line p-3">
            <button
              onClick={toggleCollapse}
              className="hidden w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-subtle hover:text-ink lg:flex"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg">
                <Icon name={collapsed ? "chevron-right" : "chevron-left"} className="h-[18px] w-[18px] rtl:rotate-180" />
              </span>
              <span className="nav-label">{dict.shell.collapse}</span>
            </button>
            <form action="/api/signout" method="post">
              <button
                type="submit"
                title={dict.shell.signOut}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate transition hover:bg-danger/10 hover:text-danger"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg">
                  <Icon name="power" className="h-[18px] w-[18px]" />
                </span>
                <span className="nav-label">{dict.shell.signOut}</span>
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
