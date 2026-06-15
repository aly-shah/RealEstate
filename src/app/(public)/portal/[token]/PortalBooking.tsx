"use client";

import { useState } from "react";

/** Two-digit pad for the datetime-local min attribute. */
function localMin(): string {
  const d = new Date(Date.now() + 30 * 60_000); // earliest bookable = +30 min
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Inline "request a viewing" control on a portal property card. Posts the chosen
 * time to /api/public/portal-booking, which books a SHOWING for the client's
 * agent. Kept deliberately small — a link that expands to a datetime picker.
 */
export function PortalBooking({
  token,
  propertyId,
  accent,
}: {
  token: string;
  propertyId: string;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  // Lazy initialiser runs once on mount — keeps Date.now() out of render.
  const [min] = useState(localMin);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit() {
    if (!when) {
      setState("error");
      setMsg("Pick a date and time first.");
      return;
    }
    setState("loading");
    setMsg("");
    try {
      const res = await fetch("/api/public/portal-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, propertyId, startAt: new Date(when).toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not request the viewing.");
      setState("done");
      setMsg("Requested — your agent will confirm the time.");
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    }
  }

  if (state === "done") {
    return <p className="mt-2 text-xs font-medium text-ok">✓ {msg}</p>;
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold"
          style={{ color: accent }}
        >
          Request a viewing
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            min={min || undefined}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="field h-9 w-auto py-1 text-xs"
            aria-label="Preferred viewing date and time"
          />
          <button
            type="button"
            onClick={submit}
            disabled={state === "loading"}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: accent }}
          >
            {state === "loading" ? "Sending…" : "Request"}
          </button>
        </div>
      )}
      {state === "error" && <p className="mt-1 text-xs text-danger">{msg}</p>}
    </div>
  );
}
