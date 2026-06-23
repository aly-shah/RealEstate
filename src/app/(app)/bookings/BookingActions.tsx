"use client";

import { useState, useTransition } from "react";
import { approveBooking, rejectBooking } from "./actions";

/** Office approve/reject buttons for a pending booking. */
export function BookingActions({ bookingId }: { bookingId: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<{ error?: string }>) {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (r.error) setErr(r.error);
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" disabled={pending} onClick={() => run(() => approveBooking(bookingId))} className="btn-accent !px-2.5 !py-1 text-xs">Approve</button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const note = window.prompt("Reason for rejecting (optional):") ?? undefined;
          run(() => rejectBooking(bookingId, note));
        }}
        className="btn-ghost !px-2.5 !py-1 text-xs"
      >
        Reject
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
