"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Locale } from "@/lib/i18n/dictionary";

interface LocaleSwitcherProps {
  locale: Locale;
  switchLabel: string;
  ariaLabel: string;
}

const COOKIE = "pz-locale";

export function LocaleSwitcher({ locale, switchLabel, ariaLabel }: LocaleSwitcherProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next: Locale = locale === "en" ? "ur" : "en";
    // 1-year cookie, site-wide.
    document.cookie = `${COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    // Apply immediately so the user sees the flip without waiting for the round-trip.
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ur" ? "rtl" : "ltr";
    document.documentElement.dataset.locale = next;
    startTransition(() => router.refresh());
  };

  return (
    <button
      onClick={toggle}
      disabled={pending}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="grid h-10 min-w-10 place-items-center rounded-xl border border-line bg-white px-3 text-sm font-semibold text-slate transition hover:border-accent/40 hover:text-accent hover:shadow-[var(--shadow-card)] disabled:opacity-60"
    >
      <span className="flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
        {switchLabel}
      </span>
    </button>
  );
}
