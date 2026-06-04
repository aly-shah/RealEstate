"use client";

import { useState, useSyncExternalStore } from "react";
import { setPropertyShare } from "@/app/(app)/properties/actions";
import { Icon } from "@/components/ui/Icon";

// Read the current origin without a hydration mismatch: "" on the server and
// first client render, then the real origin once hydrated.
const subscribe = () => () => {};
function useOrigin() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );
}

interface SharePropertyProps {
  propertyId: string;
  enabled: boolean;
  slug: string | null;
}

/**
 * "Share with client" control on the property page. Toggles the public link via
 * the setPropertyShare server action (which revalidates this page, so `enabled`
 * / `slug` flow back down as props), then exposes copy + WhatsApp helpers. The
 * absolute URL is built client-side from the current origin.
 */
export function ShareProperty({ propertyId, enabled, slug }: SharePropertyProps) {
  const origin = useOrigin();
  const [copied, setCopied] = useState(false);

  const link = slug ? `${origin}/p/${slug}` : "";

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the field is selectable as a fallback */
    }
  }

  const waShare = link
    ? `https://wa.me/?text=${encodeURIComponent(`Take a look at this property: ${link}`)}`
    : "";

  return (
    <div className="space-y-3">
      <form action={setPropertyShare} className="flex items-center justify-between gap-3">
        <input type="hidden" name="id" value={propertyId} />
        <input type="hidden" name="enabled" value={(!enabled).toString()} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Public link</p>
          <p className="text-xs text-muted">{enabled ? "Anyone with the link can view this listing." : "Off — the link won’t work."}</p>
        </div>
        <button
          type="submit"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle public link"
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? "bg-accent" : "bg-line"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "start-[22px]" : "start-0.5"}`} />
        </button>
      </form>

      {enabled && slug && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link || `…/p/${slug}`}
              onFocus={(e) => e.currentTarget.select()}
              className="field text-xs"
              dir="ltr"
            />
            <button type="button" onClick={copy} className="btn-ghost shrink-0 px-3 py-2 text-xs">
              {copied ? <><Icon name="check" className="h-3.5 w-3.5" /> Copied</> : "Copy"}
            </button>
          </div>
          <a href={waShare} target="_blank" rel="noopener noreferrer" className="btn-ghost inline-flex w-full justify-center py-2 text-xs">
            <Icon name="message" className="h-3.5 w-3.5" /> Share on WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}
