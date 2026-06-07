/**
 * Idempotency guard for financial mutations (PR4).
 *
 * A double-submitted form (impatient click, retried network request, browser
 * back-then-resubmit) must not create two payments. The client generates a
 * UUID per action and submits it; `runOnce` reserves the (companyId, scope,
 * key) row before doing the work. A second call with the same key collides on
 * the unique index and replays the prior result instead of writing again.
 *
 * Reuses the same pattern the Job queue already trusts for webhook dedup.
 */
import { prisma } from "@/lib/prisma";

export interface OnceResult<T> {
  /** The freshly-created entity, or null on a replay. */
  result: T | null;
  /** True when this key was already used — `op` did NOT run this time. */
  replayed: boolean;
  /** Id of the entity created by the first run (for redirect/links on replay). */
  resultId: string | null;
}

/**
 * Run `op` at most once per (companyId, scope, key). On a replay, returns the
 * stored `resultId` from the first run without re-executing.
 *
 *   const { result, replayed, resultId } = await runOnce(
 *     companyId, "payment.create", form.idempotencyKey,
 *     () => prisma.payment.create({ data }),
 *   );
 *   if (replayed) return { ok: true };   // already recorded — treat as success
 */
export async function runOnce<T extends { id: string }>(
  companyId: string,
  scope: string,
  key: string,
  op: () => Promise<T>,
): Promise<OnceResult<T>> {
  // Reserve the key first. If it already exists, this is a replay.
  try {
    await prisma.idempotencyKey.create({ data: { companyId, scope, key } });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const prior = await prisma.idempotencyKey.findUnique({
        where: { companyId_scope_key: { companyId, scope, key } },
      });
      return { result: null, replayed: true, resultId: prior?.resultId ?? null };
    }
    throw e;
  }

  // First time through — do the work and record what it produced.
  const result = await op();
  await prisma.idempotencyKey.update({
    where: { companyId_scope_key: { companyId, scope, key } },
    data: { resultId: result.id },
  });
  return { result, replayed: false, resultId: result.id };
}

/** Prisma unique-constraint violation = P2002. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
