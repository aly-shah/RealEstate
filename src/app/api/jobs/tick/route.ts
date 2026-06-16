import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDueJobs } from "@/lib/jobs/runner";
import { runDripEnrollments } from "@/lib/drip";
import {
  sweepExpiredTrials,
  sweepStuckJobs,
  purgeOldRows,
  sweepWhatsAppTokens,
  sweepWhatsAppTemplateCatalog,
  sweepPaymentReminders,
} from "@/lib/jobs/sweeps";
import { claimDailySweep } from "@/lib/jobs/throttle";

export const runtime = "nodejs";

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
  // Drip sequences are time-sensitive (hour-granularity), so run every tick
  // rather than on the daily throttle. Bounded per run.
  const drips = await runDripEnrollments();

  let purge: Awaited<ReturnType<typeof purgeOldRows>> | null = null;
  let waProbe: Awaited<ReturnType<typeof sweepWhatsAppTokens>> | null = null;
  let waCatalog: Awaited<ReturnType<typeof sweepWhatsAppTemplateCatalog>> | null = null;
  let paymentReminders: Awaited<ReturnType<typeof sweepPaymentReminders>> | null = null;
  // Daily-throttled sweeps — each claimed at most once per 24h via a durable
  // marker (SweepState), so a PM2 restart / redeploy can't re-fire them.
  if (await claimDailySweep("purge")) {
    purge = await purgeOldRows();
  }
  if (await claimDailySweep("payment-reminders")) {
    paymentReminders = await sweepPaymentReminders();
  }
  if (await claimDailySweep("whatsapp-tokens")) {
    // Token probe + catalog refresh both early-return when no tenant has
    // WhatsApp configured.
    waProbe = await sweepWhatsAppTokens();
  }
  if (await claimDailySweep("whatsapp-catalog")) {
    waCatalog = await sweepWhatsAppTemplateCatalog();
  }

  return NextResponse.json({
    reaper,
    sweep,
    queue,
    drips,
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
