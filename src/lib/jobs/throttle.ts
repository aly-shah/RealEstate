import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Durable, atomic "claim" for a daily-throttled sweep. Returns true at most once
 * per `intervalMs` window across ALL processes and restarts — backed by the
 * SweepState table instead of a per-process global, so a PM2 restart / redeploy
 * no longer re-fires a daily sweep within its window.
 *
 * The conditional updateMany is a single atomic UPDATE (claims only if the last
 * run is stale); the create handles the very first run, with the @id unique
 * constraint making a concurrent double-claim impossible.
 */
export async function claimDailySweep(key: string, intervalMs: number = DAY_MS): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - intervalMs);

  const claimed = await prisma.sweepState.updateMany({
    where: { key, lastRunAt: { lt: cutoff } },
    data: { lastRunAt: now },
  });
  if (claimed.count > 0) return true;

  // No existing row was stale enough to claim — either it ran recently, or this
  // key has never run. Try to create it (first run); a unique-violation means a
  // row already exists and was recent, so it's not due.
  try {
    await prisma.sweepState.create({ data: { key, lastRunAt: now } });
    return true;
  } catch {
    return false;
  }
}
