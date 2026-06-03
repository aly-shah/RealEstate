/**
 * Sliding-window rate limiter, in-process memory only.
 *
 * Why in-process: the deploy runs a single PM2 fork (`instances: 1`), so a
 * Node-level Map sees every request. If you ever scale to PM2 cluster mode
 * or multiple boxes, swap the `STORE` with Redis (`INCR` + `EXPIRE`) — every
 * call site stays the same.
 *
 * Keys are caller-defined (e.g. `login:ip:1.2.3.4`, `upload:user:abc123`)
 * so different limiters share this file without colliding.
 */

type Bucket = { hits: number[]; firstHit: number };
const STORE = new Map<string, Bucket>();

// Walk the store every minute and drop empty buckets so memory doesn't leak.
// Wrapped in a guard so the timer is only installed once (HMR-safe).
const SWEEP_INTERVAL_MS = 60_000;
const g = globalThis as unknown as { __rlSweepInstalled?: boolean };
if (!g.__rlSweepInstalled) {
  g.__rlSweepInstalled = true;
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of STORE) {
      // If the oldest hit is older than 1 hour, prune the whole bucket.
      if (b.hits.length === 0 || now - b.hits[b.hits.length - 1] > 3_600_000) {
        STORE.delete(k);
      }
    }
  }, SWEEP_INTERVAL_MS).unref();
}

export interface RateLimitOptions {
  /** Distinct identifier — usually `scope:identifier`, e.g. `login:ip:1.2.3.4`. */
  key: string;
  /** Maximum hits allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** How many hits remain in the current window (0 if blocked). */
  remaining: number;
  /** Milliseconds until the next slot opens (0 if `allowed`). */
  retryAfterMs: number;
}

/**
 * Records an attempt and returns whether it should be allowed.
 *
 * Sliding window: keeps the timestamps of every hit inside `windowMs`. When
 * `hits.length >= limit`, the request is rejected. Old hits expire naturally
 * as time advances.
 */
export function rateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const cutoff = now - opts.windowMs;
  const bucket = STORE.get(opts.key) ?? { hits: [], firstHit: now };

  // Drop hits outside the window.
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= opts.limit) {
    STORE.set(opts.key, bucket);
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + opts.windowMs - now),
    };
  }

  bucket.hits.push(now);
  STORE.set(opts.key, bucket);
  return {
    allowed: true,
    remaining: opts.limit - bucket.hits.length,
    retryAfterMs: 0,
  };
}

/**
 * Reset a key (e.g. on successful login, to forgive prior failed attempts).
 * Skip for the "any-IP" limiter to keep DoS protection effective.
 */
export function resetRateLimit(key: string): void {
  STORE.delete(key);
}

/** Pretty-print remaining-time for user-facing messages. */
export function formatRetryAfter(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}
