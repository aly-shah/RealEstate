"use client";

import { useState } from "react";

/**
 * Public share control on the listing page itself. Uses the native share sheet
 * when the browser/device supports it (mobile), otherwise copies the current
 * page URL to the clipboard and confirms with a brief "Link copied" state.
 * Reads the live URL from the address bar, so it always shares exactly the page
 * the visitor is on.
 */
export function CopyLinkButton({ title, fullWidth = false }: { title: string; fullWidth?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;

    // Native share sheet (mobile) — the most natural "send this listing" flow.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* user dismissed the sheet — fall through to clipboard */
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — nothing else we can safely do */
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className={`inline-flex items-center justify-center gap-2 border border-slate-300 bg-white font-medium text-slate-800 transition hover:bg-slate-50 active:scale-[0.98] ${
        fullWidth
          ? "w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
          : "rounded-full px-4 py-2 text-sm"
      }`}
    >
      {copied ? (
        <>
          <CheckIcon /> Link copied
        </>
      ) : (
        <>
          <ShareIcon /> Share
        </>
      )}
    </button>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
