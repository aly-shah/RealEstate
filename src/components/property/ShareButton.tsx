"use client";

import { useState, useSyncExternalStore } from "react";
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

interface ShareButtonProps {
  slug: string;
  title: string;
  reference: string;
}

/**
 * Always-on share control for the property detail page. Every listing has a
 * public page from creation (see createProperty), so there's no "enable" step —
 * the agent just copies the link or fires it into WhatsApp. The absolute URL is
 * built client-side from the current origin.
 */
export function ShareButton({ slug, title, reference }: ShareButtonProps) {
  const origin = useOrigin();
  const [copied, setCopied] = useState(false);

  const link = origin ? `${origin}/p/${slug}` : `/p/${slug}`;
  const waText = encodeURIComponent(`Check out this property: ${title} (${reference})\n${link}`);
  const waHref = `https://wa.me/?text=${waText}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the link stays visible below for manual copy */
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        This listing has a public page anyone can open — no account needed.
      </p>

      <div className="flex items-center gap-2 rounded-xl border border-line bg-canvas px-3 py-2">
        <Icon name="share" className="h-4 w-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-sm text-slate">{link}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="btn-primary">
          <Icon name={copied ? "check" : "document"} className="h-4 w-4" />
          {copied ? "Copied" : "Copy link"}
        </button>
        <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn-ghost">
          <Icon name="message" className="h-4 w-4" />
          WhatsApp
        </a>
        <a href={link} target="_blank" rel="noopener noreferrer" className="btn-ghost">
          <Icon name="arrow-right" className="h-4 w-4" />
          Preview
        </a>
      </div>
    </div>
  );
}
