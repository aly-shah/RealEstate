import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDueJobs } from "@/lib/jobs/runner";
import {
  sweepExpiredTrials,
  sweepStuckJobs,
  purgeOldRows,
  sweepWhatsAppTokens,
  sweepWhatsAppTemplateCatalog,
  sweepPaymentReminders,
} from "@/lib/jobs/sweeps";

export const runtime = "nodejs";

// Daily-throttle markers — per-process. Single PM2 fork means one run
// per day. Safe because the underlying sweeps are idempotent / no-op
// when there's nothing to do.
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const g = globalThis as unknown as {
  __lastPurgeAt?: number;
  __lastWhatsAppProbeAt?: number;
  __lastWhatsAppCatalogAt?: number;
  __lastPaymentReminderAt?: number;
};

/**
 * Cron-driven entry point that drains the job queue + runs always-on sweeps.
 *
 * Auth: shared secret in `JOBS_TICK_TOKEN`. Without it the route refuses
 * every call — fail-closed so an accidentally-public endpoint can't be used
 * as a DoS amplifier. Timing-safe compare so brute-force attempts can't
 * leak token length.
 *
 * Crontab on the VPS (every minute):
 *   * * * * * curl -fsS -X POST \
 *     -H "Authorization: Bearer $JOBS_TICK_TOKEN" \
 *     https://crm.proptimizr.com/api/jobs/tick > /var/log/proptimizr-jobs.log 2>&1
 */
export async function POST(req: NextRequest) {
  const expected = process.env.JOBS_TICK_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "JOBS_TICK_TOKEN not configured on the server." },
      { status: 503 },
    );
  }

  const supplied = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!supplied || !sameLength(supplied, expected) || !equalsConstantTime(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Order matters:
  //   1. Reaper first  — frees stuck rows so they can be picked up this tick.
  //   2. Trial expiry  — fast, must precede anything billing-aware.
  //   3. Queue drain   — does the actual work.
  //   4. Purge (once/day) — last so today's runs survive their TTL window.
  const reaper = await sweepStuckJobs();
  const sweep = await sweepExpiredTrials();
  const queue = await runDueJobs();

  let purge: Awaited<ReturnType<typeof purgeOldRows>> | null = null;
  let waProbe: Awaited<ReturnType<typeof sweepWhatsAppTokens>> | null = null;
  let waCatalog: Awaited<ReturnType<typeof sweepWhatsAppTemplateCatalog>> | null = null;
  let paymentReminders: Awaited<ReturnType<typeof sweepPaymentReminders>> | null = null;
  const now = Date.now();
  if (!g.__lastPurgeAt || now - g.__lastPurgeAt >= DAILY_INTERVAL_MS) {
    purge = await purgeOldRows();
    g.__lastPurgeAt = now;
  }
  if (!g.__lastPaymentReminderAt || now - g.__lastPaymentReminderAt >= DAILY_INTERVAL_MS) {
    paymentReminders = await sweepPaymentReminders();
    g.__lastPaymentReminderAt = now;
  }
  if (!g.__lastWhatsAppProbeAt || now - g.__lastWhatsAppProbeAt >= DAILY_INTERVAL_MS) {
    // Token probe + catalog refresh share the same daily throttle. Both
    // sweeps early-return when no tenant has WhatsApp configured.
    waProbe = await sweepWhatsAppTokens();
    g.__lastWhatsAppProbeAt = now;
  }
  if (!g.__lastWhatsAppCatalogAt || now - g.__lastWhatsAppCatalogAt >= DAILY_INTERVAL_MS) {
    waCatalog = await sweepWhatsAppTemplateCatalog();
    g.__lastWhatsAppCatalogAt = now;
  }

  return NextResponse.json({
    reaper,
    sweep,
    queue,
    purge,
    waProbe,
    waCatalog,
    paymentReminders,
    at: new Date().toISOString(),
  });
}

// Optional GET — same auth — for "is the cron healthy?" probes that don't
// want to actually trigger a run. Returns metadata, no mutations.
export async function GET(req: NextRequest) {
  const expected = process.env.JOBS_TICK_TOKEN;
  if (!expected) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const supplied = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!supplied || !sameLength(supplied, expected) || !equalsConstantTime(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}

/** Pre-check that both strings are the same length so timingSafeEqual won't throw. */
function sameLength(a: string, b: string): boolean {
  return Buffer.byteLength(a) === Buffer.byteLength(b);
}

function equalsConstantTime(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
