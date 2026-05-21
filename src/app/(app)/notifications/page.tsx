import Link from "next/link";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { fmtDateTime, humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { markRead, markAllRead } from "./actions";

export default async function NotificationsPage() {
  const user = await requireUser();

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div>
      <PageHeader
        eyebrow="Alerts"
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up."}
        action={
          unread > 0 ? (
            <form action={markAllRead}>
              <button className="btn-ghost text-sm">Mark all read</button>
            </form>
          ) : null
        }
      />

      {notifications.length === 0 ? (
        <EmptyState title="No notifications" hint="Reminders and alerts will show up here." />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`surface flex items-center justify-between gap-3 px-4 py-3 ${n.read ? "opacity-70" : ""}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                  <p className="truncate text-sm font-semibold text-ink">{n.title}</p>
                  <Badge tone="neutral">{humanize(n.type)}</Badge>
                </div>
                {n.body && <p className="truncate text-xs text-muted">{n.body}</p>}
                <p className="text-xs text-muted">{fmtDateTime(n.createdAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {n.link && <Link href={n.link} className="text-xs font-semibold text-accent">Open →</Link>}
                {!n.read && (
                  <form action={markRead}>
                    <input type="hidden" name="id" value={n.id} />
                    <button className="btn-ghost px-2 py-1 text-xs">Mark read</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
