"use client";

import { useEffect, useRef, useState } from "react";
import { startWaQrLink, unlinkWaQr } from "./wa-qr-actions";

type Status = "LOADING" | "PENDING" | "CONNECTED" | "DISCONNECTED";

export function WaQrLink() {
  const [status, setStatus] = useState<Status>("LOADING");
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function poll() {
    try {
      const res = await fetch("/api/whatsapp/qr-status", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { status: Status; qr: string | null };
      setStatus(d.status);
      setQr(d.qr);
      if (d.status === "CONNECTED") stopPolling();
    } catch {
      /* transient */
    }
  }

  function stopPolling() {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }

  useEffect(() => {
    // Fetch current status on mount; poll() sets state in its async callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function link() {
    setBusy(true);
    setStatus("PENDING");
    setQr(null);
    await startWaQrLink();
    await poll();
    if (!timer.current) timer.current = setInterval(() => void poll(), 2500);
    setBusy(false);
  }

  async function unlink() {
    setBusy(true);
    stopPolling();
    await unlinkWaQr();
    setStatus("DISCONNECTED");
    setQr(null);
    setBusy(false);
  }

  return (
    <div>
      <p className="mb-3 rounded-xl border border-warn/30 bg-warn-bg px-3 py-2 text-xs text-warn">
        ⚠️ Unofficial: this links a normal WhatsApp number by scanning a QR (like WhatsApp Web). It is against
        WhatsApp&rsquo;s terms and the number can be banned. For production, prefer the official WhatsApp Business API above.
      </p>

      {status === "LOADING" && <p className="text-sm text-muted">Checking connection…</p>}

      {status === "CONNECTED" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-ok">
            <span className="h-2 w-2 rounded-full bg-ok" /> WhatsApp connected
          </p>
          <button type="button" onClick={unlink} disabled={busy} className="btn-ghost text-xs text-danger">
            {busy ? "…" : "Unlink"}
          </button>
        </div>
      )}

      {(status === "DISCONNECTED") && (
        <button type="button" onClick={link} disabled={busy} className="btn-accent">
          {busy ? "Starting…" : "Link with QR"}
        </button>
      )}

      {status === "PENDING" && (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <div className="grid h-[248px] w-[248px] place-items-center rounded-2xl border border-line bg-white">
            {qr ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={qr} alt="WhatsApp QR code" width={224} height={224} />
            ) : (
              <span className="text-sm text-muted">Generating QR…</span>
            )}
          </div>
          <div className="text-sm text-slate">
            <p className="font-medium text-ink">Scan to link</p>
            <ol className="mt-1 list-decimal space-y-0.5 ps-4 text-xs text-muted">
              <li>Open WhatsApp on your phone</li>
              <li>Settings → Linked devices → Link a device</li>
              <li>Point your phone at this QR</li>
            </ol>
            <button type="button" onClick={unlink} disabled={busy} className="btn-ghost mt-3 text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
