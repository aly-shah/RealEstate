"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { Dict } from "@/lib/i18n/dictionary";

interface Tab {
  href: string;
  icon: IconName;
  labelKey: keyof Dict["nav"];
}

const TABS: Tab[] = [
  { href: "/dashboard",     icon: "dashboard", labelKey: "dashboard"     },
  { href: "/leads",         icon: "target",    labelKey: "leads"         },
  { href: "/visits",        icon: "flag",      labelKey: "visits"        },
  { href: "/calendar",      icon: "calendar",  labelKey: "calendar"      },
  { href: "/notifications", icon: "bell",      labelKey: "notifications" },
];

/** Fixed bottom tab bar for the agent panel — phone only (hidden on lg). */
export function AgentBottomNav({ unreadCount = 0, dict }: { unreadCount?: number; dict: Dict }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-paper/85 backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-5">
        {TABS.map((t) => {
          const active = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <span className={`relative grid h-9 w-9 place-items-center rounded-xl transition ${
                active ? "bg-accent-wash text-accent shadow-[var(--shadow-card)]" : ""
              }`}>
                <Icon name={t.icon} className="h-5 w-5" />
                {t.href === "/notifications" && unreadCount > 0 && (
                  <span className="absolute -end-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-danger px-0.5 text-[9px] font-semibold text-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
              {dict.nav[t.labelKey]}
              {active && <span className="absolute inset-x-7 top-0 h-0.5 rounded-full bg-accent" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
