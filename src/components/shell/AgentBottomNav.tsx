"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Today", icon: "▣" },
  { href: "/leads", label: "Leads", icon: "◎" },
  { href: "/visits", label: "Visits", icon: "⚑" },
  { href: "/calendar", label: "Calendar", icon: "▦" },
  { href: "/notifications", label: "Alerts", icon: "◔" },
];

/** Fixed bottom tab bar for the agent panel — phone only (hidden on lg). */
export function AgentBottomNav({ unreadCount = 0 }: { unreadCount?: number }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-paper/95 backdrop-blur lg:hidden">
      {TABS.map((t) => {
        const active = isActive(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition ${
              active ? "text-ink" : "text-muted"
            }`}
          >
            <span className="relative text-lg leading-none">
              {t.icon}
              {t.href === "/notifications" && unreadCount > 0 && (
                <span className="absolute -right-2 -top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-accent px-0.5 text-[9px] font-semibold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </span>
            {t.label}
            {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );
}
