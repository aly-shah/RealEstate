import type { UserStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Cached `User.status` lookup with a short TTL.
 *
 * Why a cache: every protected page render calls requireUser, which now needs
 * to know if the underlying user is still ACTIVE. Hitting the DB on every
 * request would add a roundtrip to every navigation; caching for 60s caps
 * the worst-case "still logged in after suspension" window at one minute.
 *
 * The cache is per-process; under PM2 fork mode (current deploy) there's one
 * process so all requests see the same view. If you scale to cluster mode,
 * swap this for Redis with a 60s TTL — interface stays the same.
 */

const CACHE_TTL_MS = 60 * 1000;
type Entry = { status: UserStatus | null; until: number };
const CACHE = new Map<string, Entry>();

/**
 * Returns the user's current `status`, or `null` if the user no longer exists
 * (deleted accounts should also be treated as invalid sessions).
 */
export async function getCachedUserStatus(userId: string): Promise<UserStatus | null> {
  const now = Date.now();
  const cached = CACHE.get(userId);
  if (cached && cached.until > now) return cached.status;

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  const status = row?.status ?? null;
  CACHE.set(userId, { status, until: now + CACHE_TTL_MS });
  return status;
}

/**
 * Force a re-read on the next request. Call this from any action that
 * changes a user's status (e.g. setUserStatus in settings/actions.ts) so the
 * cache window doesn't extend the lockout grace period unnecessarily.
 */
export function invalidateUserStatus(userId: string): void {
  CACHE.delete(userId);
}

/**
 * Convenience: true if the user is allowed to operate. SUPER_ADMIN bypasses
 * the suspension check (their account isn't subject to tenant suspension).
 * Used by route handlers (`/api/upload`, `/api/files`) that call `auth()`
 * directly and don't go through requireUser.
 */
export async function isUserActive(userId: string, role: string): Promise<boolean> {
  if (role === "SUPER_ADMIN") return true;
  const status = await getCachedUserStatus(userId);
  return status === "ACTIVE";
}

// Throttle map for lastSeenAt writes — separate from the status cache because
// the concerns differ (status cache wants to avoid DB *reads*; this throttle
// wants to avoid DB *writes* + the resulting WAL/index churn).
const SEEN_THROTTLE_MS = 60_000;
const SEEN_TOUCHED = new Map<string, number>();

/**
 * Stamp `User.lastSeenAt = now()` for this user, but at most once per minute
 * per process. Fire-and-forget — the caller (requireUser) doesn't wait on
 * the write and swallows any failure so a transient DB hiccup doesn't
 * cascade into a 500 on every page render.
 */
export function touchUserSeen(userId: string): void {
  const now = Date.now();
  const last = SEEN_TOUCHED.get(userId) ?? 0;
  if (now - last < SEEN_THROTTLE_MS) return;
  SEEN_TOUCHED.set(userId, now);
  prisma.user
    .update({ where: { id: userId }, data: { lastSeenAt: new Date(now) } })
    .catch(() => {
      // Reset throttle on failure so the next request retries promptly
      // rather than waiting out the full window.
      SEEN_TOUCHED.delete(userId);
    });
}
