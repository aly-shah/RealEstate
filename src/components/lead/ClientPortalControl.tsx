"use client";

import { useState, useSyncExternalStore } from "react";
import { setClientPortal } from "@/app/(app)/leads/actions";
import { Icon } from "@/components/ui/Icon";

// Read the current origin without a hydration mismatch.
const subscribe = () => () => {};
function useOrigin() {
  return useSyncExternalStore(subscribe, () => window.location.origin, () => "");
}

interface ClientPortalControlProps {
  leadId: string;
  enabled: boolean;
  token: string | null;
}

/**
 * "Client portal" control on the lead page. Toggles the login-free portal via
 * setClientPortal (which revalidates, so enabled/token flow back as props), then
 * exposes copy + WhatsApp share. The absolute URL is built client-side.
 */
export function ClientPortalControl({ leadId, enabled, token }: ClientPortalControlProps) {
  const origin = useOrigin();
  const [copied, setCopied] = useState(false);
  const link = token ? `${origin}/portal/${token}` : "";

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
    ? `https://wa.me/?text=${encodeURIComponent(`Here is your personal property portal: ${link}`)}`
    : "";

  return (
    <div className="space-y-3">
      <form action={setClientPortal} className="flex items-center justify-between gap-3">
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="enabled" value={(!enabled).toString()} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Portal link</p>
          <p className="text-xs text-muted">
            {enabled ? "The client can view their shortlist, visits & payments — no login." : "Off — the link won’t work."}
          </p>
        </div>
        <button
          type="submit"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle client portal"
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? "bg-accent" : "bg-line"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "start-[22px]" : "start-0.5"}`} />
        </button>
      </form>

      {enabled && token && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link || `…/portal/${token}`}
              onFocus={(e) => e.currentTarget.select()}
              className="field text-xs"
              dir="ltr"
            />
            <button type="button" onClick={copy} className="btn-ghost shrink-0 px-3 py-2 text-xs">
              {copied ? <><Icon name="check" className="h-3.5 w-3.5" /> Copied</> : "Copy"}
            </button>
          </div>
          <a href={waShare} target="_blank" rel="noopener noreferrer" className="btn-ghost inline-flex w-full justify-center py-2 text-xs">
            <Icon name="message" className="h-3.5 w-3.5" /> Send on WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}
