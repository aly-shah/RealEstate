/**
 * Optimistic concurrency helpers (PR4).
 *
 * Read-modify-write over a UI form is a classic lost-update race: two users
 * load the same commission/payment, both submit, the second silently clobbers
 * the first. These helpers turn the write into a compare-and-swap so the loser
 * gets a clear "it changed, reload" error instead of overwriting newer data.
 *
 * Two flavours:
 *   - casUpdate:       version-based — for edit forms that round-trip a hidden
 *                      `version` field. Bumps the version on success.
 *   - casUpdateGuarded: predicate-based — for state transitions where the
 *                      current state IS the guard (e.g. only approve a
 *                      PENDING_APPROVAL commission). No version field needed.
 */

export class ConcurrentUpdateError extends Error {
  constructor(message = "This record changed since you loaded it. Reload and try again.") {
    super(message);
    this.name = "ConcurrentUpdateError";
  }
}

/** Minimal shape of a Prisma model delegate's `updateMany`. */
interface UpdatableDelegate {
  updateMany: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<{ count: number }>;
}

/**
 * Version-based compare-and-swap. Updates the row only if its `version` still
 * matches `expectedVersion`, and increments it. Throws ConcurrentUpdateError
 * when nothing matched (someone else wrote first, or the row is gone).
 *
 *   await casUpdate(prisma.payment, id, companyId, Number(form.version), {
 *     amount: new Prisma.Decimal(amount),
 *   });
 */
export async function casUpdate(
  delegate: UpdatableDelegate,
  id: string,
  companyId: string,
  expectedVersion: number,
  data: Record<string, unknown>,
): Promise<void> {
  const { count } = await delegate.updateMany({
    where: { id, companyId, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  if (count === 0) throw new ConcurrentUpdateError();
}

/**
 * Predicate-based compare-and-swap for state transitions. Updates only rows
 * matching the full `where` (which should pin the expected current state, plus
 * companyId for tenant safety) and bumps `version` if the model has one.
 * Returns false instead of throwing so callers can branch on "already done".
 *
 *   const moved = await casUpdateGuarded(prisma.commission, {
 *     id, companyId, status: "PENDING_APPROVAL",
 *   }, { status: "APPROVED", approvedById: user.id, approvedAt: new Date() });
 *   if (!moved) { flash("Already processed by someone else."); return; }
 */
export async function casUpdateGuarded(
  delegate: UpdatableDelegate,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<boolean> {
  const { count } = await delegate.updateMany({
    where,
    data: { ...data, version: { increment: 1 } },
  });
  return count > 0;
}
