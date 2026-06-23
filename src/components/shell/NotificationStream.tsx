"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

interface LiveToast { title: string; link?: string | null }

/**
 * Opens an SSE stream to /api/notifications/stream. On a new notification it
 * shows a transient toast and refreshes the route so the bell badge updates
 * live (no page reload). EventSource auto-reconnects if the connection drops.
 */
export function NotificationStream() {
  const router = useRouter();
  const [toast, setToast] = useState<LiveToast | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) return;
    const es = new EventSource("/api/notifications/stream");
    es.addEventListener("notification", (ev) => {
      let data: LiveToast | null = null;
      try {
        data = JSON.parse((ev as MessageEvent).data) as LiveToast;
      } catch {
        return;
      }
      setToast({ title: data?.title || "New notification", link: data?.link ?? null });
      router.refresh(); // re-render the layout → updated unread bell badge
    });
    return () => es.close();
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  const body = (
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-wash text-accent">
        <Icon name="bell" className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">New notification</p>
        <p className="truncate text-sm font-medium text-ink">{toast.title}</p>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-sm rounded-2xl border border-accent/30 bg-paper p-3 shadow-[var(--shadow-pop)] lg:inset-x-auto lg:bottom-6 lg:end-6">
      {toast.link ? (
        <Link href={toast.link} onClick={() => setToast(null)} className="block">{body}</Link>
      ) : (
        body
      )}
    </div>
  );
}
