import Link from "next/link";
import { GlobalSearch } from "./GlobalSearch";
import { UserMenu } from "./UserMenu";

interface TopbarProps {
  unreadCount?: number;
  name: string;
  roleLabel: string;
  canManage: boolean;
}

/** Clean white app header: global search (⌘K), notifications, user menu. */
export function Topbar({ unreadCount = 0, name, roleLabel, canManage }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 hidden h-16 items-center gap-4 border-b border-line bg-paper/85 px-6 backdrop-blur lg:flex lg:px-10">
      <div className="flex-1">
        <GlobalSearch />
      </div>

      <Link
        href="/notifications"
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-slate transition hover:border-accent/40 hover:text-accent"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
      >
        <span aria-hidden>◔</span>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Link>

      <UserMenu name={name} roleLabel={roleLabel} canManage={canManage} />
    </header>
  );
}
