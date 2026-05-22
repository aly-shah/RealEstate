import Link from "next/link";
import { GlobalSearch } from "./GlobalSearch";
import { UserMenu } from "./UserMenu";
import { LocaleSwitcher } from "@/components/i18n/LocaleSwitcher";
import type { Dict, Locale } from "@/lib/i18n/dictionary";

interface TopbarProps {
  unreadCount?: number;
  name: string;
  roleLabel: string;
  canManage: boolean;
  locale: Locale;
  dict: Dict;
}

/** Glass app header: global search (⌘K), language toggle, notifications, user menu. */
export function Topbar({ unreadCount = 0, name, roleLabel, canManage, locale, dict }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 hidden h-16 items-center gap-3 border-b border-line/70 bg-paper/70 px-6 backdrop-blur-xl lg:flex lg:px-10">
      <div className="flex-1">
        <GlobalSearch dict={dict} />
      </div>

      <LocaleSwitcher
        locale={locale}
        switchLabel={dict.locale.switchTo}
        ariaLabel={dict.locale.label}
      />

      <Link
        href="/notifications"
        className="relative grid h-10 w-10 place-items-center rounded-xl border border-line bg-white text-slate transition hover:border-accent/40 hover:text-accent hover:shadow-[var(--shadow-card)]"
        aria-label={`${dict.shell.notifications}${unreadCount ? `, ${unreadCount}` : ""}`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0v4l1.5 3h-15L6 12V8Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -end-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Link>

      <UserMenu name={name} roleLabel={roleLabel} canManage={canManage} dict={dict} />
    </header>
  );
}
