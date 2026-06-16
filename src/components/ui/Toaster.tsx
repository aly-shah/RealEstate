"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { FlashMessage, FlashTone } from "@/lib/flash";

const TONES: Record<FlashTone, { border: string; bg: string; text: string; dot: string }> = {
  ok:     { border: "border-ok/30",     bg: "bg-ok-bg",     text: "text-ok",     dot: "bg-ok" },
  warn:   { border: "border-warn/30",   bg: "bg-warn-bg",   text: "text-warn",   dot: "bg-warn" },
  danger: { border: "border-danger/30", bg: "bg-danger-bg", text: "text-danger", dot: "bg-danger" },
  info:   { border: "border-accent/30", bg: "bg-accent-wash", text: "text-accent", dot: "bg-accent" },
};

/**
 * Renders a single transient toast pulled from the server-side flash cookie.
 * Auto-dismisses after 4s; clickable href on the toast opens the target.
 *
 * Mounted at the bottom of (app)/layout — there's intentionally only one
 * toast slot. If a second flash arrives mid-display, it replaces the first
 * (the rare-enough case where queueing would add code without UX win).
 */
export function Toaster({ initial }: { initial: FlashMessage | null }) {
  // The layout remounts this per flash (via key), so initial state is the flash.
  const [toast, setToast] = useState<FlashMessage | null>(initial);

  // Clear the flash cookie client-side so it shows once. The server can't clear
  // it (Next 16 forbids cookie writes during the layout render), so the cookie is
  // non-httpOnly and expired here right after it's read. Pure side effect.
  useEffect(() => {
    if (initial) document.cookie = "pz-flash=; Max-Age=0; path=/";
  }, [initial]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  const s = TONES[toast.tone];

  const body = (
    <div
      role="status"
      aria-live="polite"
      className={`pz-fade-up pointer-events-auto flex items-center gap-3 rounded-2xl border ${s.border} ${s.bg} px-4 py-3 shadow-[var(--shadow-pop)]`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden />
      <p className={`text-sm font-medium ${s.text}`}>{toast.message}</p>
      <button
        type="button"
        onClick={() => setToast(null)}
        aria-label="Dismiss"
        className="ms-1 text-xs text-muted transition hover:text-ink"
      >
        ✕
      </button>
    </div>
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 print:hidden">
      {toast.href ? (
        <Link href={toast.href} onClick={() => setToast(null)} className="pointer-events-auto">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}
