"use client";

import { useEffect, useState } from "react";

/**
 * Registers the service worker and surfaces a tasteful "install to home screen"
 * prompt for agents on mobile. Two paths:
 *  - Android/Chromium: captures the `beforeinstallprompt` event and offers a
 *    one-tap Install button.
 *  - iOS Safari: no install event exists, so we show the manual Share → "Add to
 *    Home Screen" hint (only when not already running standalone).
 * Dismissal is remembered in localStorage so we don't nag.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwa-install-dismissed";

export function PwaSetup() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true); // assume hidden until we check

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari exposes this non-standard flag for home-screen apps.
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    let wasDismissed = false;
    try {
      wasDismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // localStorage can throw in private mode — treat as not dismissed.
    }
    // These depend on browser-only APIs (matchMedia/localStorage/userAgent) that
    // can't run during SSR, so they must be set from inside the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(wasDismissed);
    if (wasDismissed) return;

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) setShowIosHint(true);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    setDeferred(null);
    setShowIosHint(false);
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    dismiss();
  }

  if (dismissed || (!deferred && !showIosHint)) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-40 mx-auto max-w-md rounded-2xl border border-line bg-paper p-4 shadow-[var(--shadow-card)] lg:bottom-6 lg:inset-x-auto lg:end-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg font-extrabold text-white brand-gradient">
          P
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Install Proptimizr</p>
          {deferred ? (
            <p className="mt-0.5 text-xs text-slate">
              Add it to your home screen for one-tap access to leads, visits and WhatsApp.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate">
              Tap the Share button, then <span className="font-medium">Add to Home Screen</span> to install.
            </p>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            {deferred && (
              <button type="button" onClick={install} className="btn-accent text-xs">
                Install
              </button>
            )}
            <button type="button" onClick={dismiss} className="btn-ghost text-xs">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
