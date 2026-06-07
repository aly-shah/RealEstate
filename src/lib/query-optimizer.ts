/**
 * QueryOptimizer — in-process query caching, timeout guards, and N+1 detection.
 *
 * No Redis: the deploy runs a single PM2 fork (see rate-limit.ts), so a
 * Node-level Map sees every request. If you move to PM2 cluster mode, the
 * cache fragments per fork (each fork warms its own) — correctness still holds
 * because entries are TTL-bound and tag-invalidated; you just get a lower hit
 * rate. A cross-fork invalidation bus (pg_notify) is the upgrade path.
 *
 * Cache keys MUST be tenant-scoped (prefix with `co:${companyId}:`) so one
 * company can never read another's memoized result.
 */
import { performance } from "node:perf_hooks";

type Entry<T> = { value: T; expires: number; tags: Set<string> };

const CACHE = new Map<string, Entry<unknown>>();
const TAG_INDEX = new Map<string, Set<string>>(); // tag -> cache keys carrying it
const INFLIGHT = new Map<string, Promise<unknown>>(); // stampede protection

// HMR-safe single sweep timer (mirrors rate-limit.ts).
const g = globalThis as unknown as { __qoSweepInstalled?: boolean };
if (!g.__qoSweepInstalled) {
  g.__qoSweepInstalled = true;
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of CACHE) if (e.expires <= now) evict(k);
  }, 60_000).unref();
}

function evict(key: string): void {
  const e = CACHE.get(key);
  if (!e) return;
  for (const t of e.tags) {
    const keys = TAG_INDEX.get(t);
    if (keys) {
      keys.delete(key);
      if (keys.size === 0) TAG_INDEX.delete(t);
    }
  }
  CACHE.delete(key);
}

export class QueryTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`Query exceeded ${ms}ms`);
    this.name = "QueryTimeoutError";
  }
}

/**
 * Race a query against a timeout. NOTE: the losing promise is abandoned, not
 * cancelled — Prisma exposes no AbortSignal. Pair with the DB-level
 * `statement_timeout` (deploy/migrations/2026-06-07-statement-timeout.sql) for
 * real cancellation; this guard keeps the *request* from hanging on the result.
 */
export function withTimeout<T>(query: () => Promise<T>, ms = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueryTimeoutError(ms)), ms);
    timer.unref?.();
  });
  return Promise.race([query(), timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export interface CacheOptions {
  /** Time-to-live in milliseconds. */
  ttlMs: number;
  /** Tags this entry belongs to; pass any to invalidateTags() to evict it. */
  tags?: string[];
}

/**
 * Memoize an expensive read. Concurrent callers of a cold key share one
 * in-flight promise so a thundering herd hits the DB once. Always scope `key`
 * by companyId.
 *
 *   const m = await cachedQuery(
 *     `co:${companyId}:dashboard`,
 *     { ttlMs: 60_000, tags: [`co:${companyId}:revenue`] },
 *     () => withTimeout(() => loadDashboard(companyId)),
 *   );
 */
export async function cachedQuery<T>(
  key: string,
  opts: CacheOptions,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const existing = INFLIGHT.get(key);
  if (existing) return existing as Promise<T>;

  const run = (async () => {
    try {
      const value = await fetcher();
      const tags = new Set(opts.tags ?? []);
      CACHE.set(key, { value, expires: Date.now() + opts.ttlMs, tags });
      for (const t of tags) {
        let keys = TAG_INDEX.get(t);
        if (!keys) TAG_INDEX.set(t, (keys = new Set()));
        keys.add(key);
      }
      return value;
    } finally {
      INFLIGHT.delete(key);
    }
  })();

  INFLIGHT.set(key, run);
  return run;
}

/**
 * Invalidate every cached entry carrying any of these tags. Call from
 * mutations, e.g. after closing a deal:
 *   invalidateTags(`co:${companyId}:revenue`)
 */
export function invalidateTags(...tags: string[]): void {
  for (const t of tags) {
    const keys = TAG_INDEX.get(t);
    if (!keys) continue;
    for (const k of [...keys]) evict(k);
  }
}

/** Drop a single cache key. */
export function invalidateKey(key: string): void {
  evict(key);
}

/** Test/diagnostic helper — wipe everything. */
export function _clearCache(): void {
  CACHE.clear();
  TAG_INDEX.clear();
  INFLIGHT.clear();
}

// ── N+1 detection (development only) ────────────────────────────────────────
interface QueryMark {
  signature: string;
  at: number;
}
const RING: QueryMark[] = [];
const RING_MAX = 200;

/** Record a query for N+1 analysis. No-op in production. */
export function recordQuery(model: string | undefined, action: string): void {
  if (process.env.NODE_ENV === "production") return;
  RING.push({ signature: `${model ?? "$raw"}.${action}`, at: performance.now() });
  if (RING.length > RING_MAX) RING.shift();
}

/**
 * Warn when the same (model, action) fires >= `threshold` times within
 * `windowMs` — the signature of a `for (…) await prisma.x.find()` N+1. The
 * warning names the call so it can be batched with include / `in()`.
 */
export function detectNPlusOne(threshold = 10, windowMs = 50): void {
  if (process.env.NODE_ENV === "production") return;
  const now = performance.now();
  const counts = new Map<string, number>();
  for (const q of RING) {
    if (now - q.at > windowMs) continue;
    counts.set(q.signature, (counts.get(q.signature) ?? 0) + 1);
  }
  for (const [sig, n] of counts) {
    if (n >= threshold) {
      console.warn(`[N+1] ${sig} fired ${n}× within ${windowMs}ms — batch with include/in().`);
    }
  }
}
