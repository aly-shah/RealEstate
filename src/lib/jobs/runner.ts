import { prisma } from "@/lib/prisma";
import { JOB_TYPES, type JobHandler, type JobType } from "./types";
import { echoHandler } from "./handlers/echo";
import { whatsappInboundHandler } from "./handlers/whatsapp-inbound";
import { whatsappOutboundHandler } from "./handlers/whatsapp-outbound";
import { whatsappStatusHandler } from "./handlers/whatsapp-status";

/**
 * Handler registry — single source of truth for which job types the runner
 * accepts. Unknown types fail the job (no silent drop) so misrouted producers
 * are visible in /admin/jobs.
 */
const REGISTRY: Record<JobType, JobHandler> = {
  [JOB_TYPES.TEST_ECHO]: echoHandler,
  [JOB_TYPES.WHATSAPP_INBOUND]: whatsappInboundHandler,
  [JOB_TYPES.WHATSAPP_OUTBOUND]: whatsappOutboundHandler,
  [JOB_TYPES.WHATSAPP_STATUS]: whatsappStatusHandler,
  // trial.expire isn't queue-driven — it's a sweep called directly from the
  // tick endpoint (see lib/jobs/sweeps.ts). Mapped here only so test rows of
  // that type don't blow up; the handler is a no-op.
  [JOB_TYPES.TRIAL_EXPIRE]: async () => ({ skipped: "use sweep instead" }),
};

/**
 * Each tick processes at most this many jobs to keep the request bounded
 * — a long backlog still drains across multiple ticks (default cron is once
 * a minute → 1200/hour at this cap).
 */
const MAX_JOBS_PER_TICK = 20;

export interface RunResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: { id: string; type: string; error: string }[];
}

/**
 * Pull due jobs, mark RUNNING, dispatch, and persist the outcome. Each job
 * is processed sequentially within a tick — workload is light enough that
 * parallelism would mostly add ordering complexity.
 *
 * Race-safe-ish: the RUNNING update uses a where-clause that asserts the
 * row is still QUEUED. Under the single-fork PM2 deploy this is effectively
 * a no-op (only one runner exists); if you ever scale to cluster mode, this
 * `updateMany`-then-check-affected pattern prevents two workers from grabbing
 * the same row.
 */
export async function runDueJobs(): Promise<RunResult> {
  const out: RunResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };

  // Pick a batch of due jobs. orderBy runAt asc so older queued work goes first.
  const candidates = await prisma.job.findMany({
    where: { status: "QUEUED", runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: MAX_JOBS_PER_TICK,
    select: { id: true, type: true, payload: true, companyId: true, attempts: true, maxAttempts: true },
  });

  for (const job of candidates) {
    // Atomically claim the row. If another worker already grabbed it, count == 0.
    // claimedAt is what the reaper sweep looks at to detect "RUNNING but the
    // server died mid-job" — startedAt is preserved as the public lifecycle
    // marker for /admin/jobs.
    const now = new Date();
    const claim = await prisma.job.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: {
        status: "RUNNING",
        startedAt: now,
        claimedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (claim.count === 0) continue;

    out.processed += 1;

    const handler = REGISTRY[job.type as JobType];
    if (!handler) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: `Unknown job type: ${job.type}`,
          finishedAt: new Date(),
        },
      });
      out.failed += 1;
      out.errors.push({ id: job.id, type: job.type, error: "Unknown job type" });
      continue;
    }

    try {
      const result = await handler({ payload: job.payload, companyId: job.companyId });
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "DONE",
          result: (result ?? null) as Parameters<typeof prisma.job.update>[0]["data"]["result"],
          finishedAt: new Date(),
          error: null,
        },
      });
      out.succeeded += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 500) : "Unknown error";
      // Retry-or-fail: jobs that haven't blown their attempts budget go back
      // to QUEUED with a short backoff so the next tick picks them up.
      const willRetry = job.attempts + 1 < job.maxAttempts;
      const retryAt = new Date(Date.now() + 60_000 * Math.pow(2, job.attempts)); // 1m → 2m → 4m

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: willRetry ? "QUEUED" : "FAILED",
          error: msg,
          runAt: willRetry ? retryAt : undefined,
          finishedAt: willRetry ? null : new Date(),
        },
      });
      out.failed += willRetry ? 0 : 1;
      out.errors.push({ id: job.id, type: job.type, error: msg });
    }
  }

  return out;
}
