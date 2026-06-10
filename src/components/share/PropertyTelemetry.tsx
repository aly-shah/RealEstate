"use client";

import { useEffect, useRef } from "react";

interface PropertyTelemetryProps {
  /** The property's public share token (NOT its id) — resolved server-side. */
  slug: string;
  /** Optional known-client token carried by a personalised share link. */
  clientId?: string | null;
}

/**
 * Invisible, non-blocking telemetry beacon for the public share page.
 *
 * Renders nothing. After a 1.5s dwell (so accidental taps / quick bounces and
 * link-preview crawlers don't count as real views) it POSTs once to
 * /api/share/track. The call is best-effort: `keepalive` lets it survive a
 * navigation away, and every error is swallowed — telemetry must never affect
 * the visitor's experience. A ref guards against double-firing under React
 * Strict Mode's double-invoked effects.
 */
export function PropertyTelemetry({ slug, clientId }: PropertyTelemetryProps) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;

    const timer = setTimeout(() => {
      if (sent.current) return;
      sent.current = true;
      // Fire-and-forget; ignore network/abort errors entirely.
      void fetch("/api/share/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, clientId: clientId ?? null }),
        keepalive: true,
      }).catch(() => {});
    }, 1500);

    return () => clearTimeout(timer);
  }, [slug, clientId]);

  return null;
}
