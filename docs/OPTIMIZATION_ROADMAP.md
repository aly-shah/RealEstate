# Proptimizr — Optimization Roadmap

> Grounded in the current codebase (read: `prisma.ts`, `rate-limit.ts`, `pagination.ts`,
> `search.ts`, `activity.ts`, `metrics.ts`, `schema.prisma`, `login/actions.ts`).
> Code below is fitted to what exists but **must be typechecked + tested before shipping**,
> and anything touching Next internals must be checked against `node_modules/next/dist/docs/`
> per `AGENTS.md` ("this is NOT the Next.js you know").

## 0. Reality check — what the request gets wrong or already has

Acting as architect, not order-taker. Before the roadmap, the corrections:

| Requested | Status | Decision |
|---|---|---|
| Login rate limiting | **Already exists** — `login/actions.ts` does IP + email/IP-pair sliding windows via `rate-limit.ts` | Keep; add *progressive lockout* only (§4.1) |
| Audit trail for sensitive ops | **Already exists** — `activity.ts` `logActivity` captures actor/IP/UA into `ActivityLog.meta._actor` | Build a typed wrapper on top, don't replace (§4.2) |
| CSRF protection for mutations | **Framework already covers** — Next 16 Server Actions enforce same-origin POST; Auth.js issues CSRF tokens | Skip custom CSRF; add a same-origin assertion only for the few custom `route.ts` mutators (§4.3) |
| RLS via Prisma **middleware** (`$use`) | **`$use` is deprecated** in Prisma 5/6 | Use a `$extends` **assertion** guard (throw on tenant query missing `companyId`), not auto-injection — preserves the existing explicit `scope.ts` system as required (§4.4) |
| Semantic-similarity AI cache | **Low ROI** at 25–1000 calls/tenant/mo; needs embeddings (extra API spend) + `pgvector` | Defer; instead normalize the input hash so near-identical inputs collide (§3.4) |
| OpenTelemetry tracing | **Heavy for single VPS** with no collector backend | Ship correlation IDs + structured logs now (§6.1); OTel only once a backend exists (§6.2) |
| Connection pooling "optimization" | Prisma's default pool (`num_cpu*2+1`) is fine for one PM2 fork | Only pin `connection_limit` + add PgBouncer when you go multi-fork (§7.2) |

Everything else is valid and sequenced below.

---

# TIER 1 — HIGH PRIORITY (do first)

## 1.1 QueryOptimizer — caching + timeout + N+1 detection

Net-new (no caching exists today). In-process, no Redis. TTL cache with **tag-based
invalidation** so a mutation can blow away exactly the dashboards it affects.

```typescript
// src/lib/query-optimizer.ts
import { performance } from "node:perf_hooks";

type Entry<T> = { value: T; expires: number; tags: Set<string> };

const CACHE = new Map<string, Entry<unknown>>();
const TAG_INDEX = new Map<string, Set<string>>(); // tag -> set of cache keys

// HMR-safe single sweep timer (mirrors rate-limit.ts pattern).
const g = globalThis as unknown as { __qoSweep?: boolean };
if (!g.__qoSweep) {
  g.__qoSweep = true;
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of CACHE) if (e.expires <= now) evict(k);
  }, 60_000).unref();
}

function evict(key: string) {
  const e = CACHE.get(key);
  if (!e) return;
  for (const t of e.tags) TAG_INDEX.get(t)?.delete(key);
  CACHE.delete(key);
}

export class QueryTimeoutError extends Error {
  constructor(public ms: number) { super(`Query exceeded ${ms}ms`); }
}

/** Race a query against a timeout. The losing promise is abandoned, not cancelled —
 *  Prisma has no AbortSignal, so pair with a statement_timeout at the DB (§1.1 SQL). */
export function withTimeout<T>(query: () => Promise<T>, ms = 5_000): Promise<T> {
  return Promise.race([
    query(),
    new Promise<never>((_, rej) => setTimeout(() => rej(new QueryTimeoutError(ms)), ms).unref()),
  ]);
}

interface CacheOpts { ttlMs: number; tags?: string[] }

/** Cache an expensive read. Concurrent callers of the same cold key share one
 *  in-flight promise (stampede protection). Always scope `key` by companyId. */
const INFLIGHT = new Map<string, Promise<unknown>>();
export async function cachedQuery<T>(key: string, opts: CacheOpts, fetcher: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const existing = INFLIGHT.get(key);
  if (existing) return existing as Promise<T>;

  const p = (async () => {
    try {
      const value = await fetcher();
      const tags = new Set(opts.tags ?? []);
      CACHE.set(key, { value, expires: Date.now() + opts.ttlMs, tags });
      for (const t of tags) (TAG_INDEX.get(t) ?? TAG_INDEX.set(t, new Set()).get(t)!).add(key);
      return value;
    } finally {
      INFLIGHT.delete(key);
    }
  })();
  INFLIGHT.set(key, p);
  return p;
}

/** Invalidate every cached query carrying any of these tags.
 *  Call from mutations, e.g. after closing a deal: invalidateTags(`co:${companyId}:revenue`). */
export function invalidateTags(...tags: string[]) {
  for (const t of tags) {
    const keys = TAG_INDEX.get(t);
    if (!keys) continue;
    for (const k of [...keys]) evict(k);
    TAG_INDEX.delete(t);
  }
}

// ── N+1 detection (dev only) ─────────────────────────────────────────────
interface QueryLog { model: string; action: string; at: number }
const RING: QueryLog[] = [];
export function recordQuery(model: string, action: string) {
  if (process.env.NODE_ENV === "production") return;
  RING.push({ model, action, at: performance.now() });
  if (RING.length > 200) RING.shift();
}
/** Warn when the same (model, action) fires >threshold times inside windowMs —
 *  the signature of a forEach-with-await N+1. Wire via a Prisma $extends query hook. */
export function detectNPlusOne(threshold = 10, windowMs = 50) {
  const now = performance.now();
  const counts = new Map<string, number>();
  for (const q of RING) {
    if (now - q.at > windowMs) continue;
    const sig = `${q.model}.${q.action}`;
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  for (const [sig, n] of counts)
    if (n >= threshold) console.warn(`[N+1] ${sig} fired ${n}× in ${windowMs}ms — batch with include/in()`);
}
```

Wire detection + a default timeout into the Prisma client via an extension (replaces
the deprecated `$use`):

```typescript
// src/lib/prisma.ts  (additions)
import { PrismaClient } from "@prisma/client";
import { recordQuery, detectNPlusOne } from "@/lib/query-optimizer";

const base = new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error","warn"] : ["error"] });

export const prisma = base.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      if (process.env.NODE_ENV !== "production") { recordQuery(model ?? "$raw", operation); detectNPlusOne(); }
      return query(args);
    },
  },
});
```

**DB change** — enforce the timeout server-side (the JS race only abandons; it doesn't
cancel the query):

```sql
-- migration: set a per-statement ceiling on the app role
ALTER ROLE re SET statement_timeout = '8s';
```

**Usage** — wrap the OwnerDashboard aggregate bundle:
```typescript
const m = await cachedQuery(`co:${companyId}:dashboard`, { ttlMs: 60_000, tags: [`co:${companyId}:revenue`] },
  () => withTimeout(() => loadDashboardMetrics(companyId)));
// in deal-close action: invalidateTags(`co:${companyId}:revenue`);
```

- **Test**: unit — cache hit returns memoized value; expired key refetches; `invalidateTags`
  evicts; two concurrent cold calls invoke `fetcher` once (stampede). Integration — close a
  deal, assert dashboard reflects new revenue within one request (tag invalidation works).
- **Rollback**: delete the file + revert `prisma.ts` extension; `statement_timeout` is a no-op
  for fast queries and reverts with `ALTER ROLE re RESET statement_timeout`.
- **Perf**: dashboard p95 from ~5 aggregate queries/req → ~0 on cache hit (60s TTL). Expect
  **70–90% fewer dashboard DB roundtrips** during active sessions.
- **Breaking**: none. Cache is per-process; correctness depends on disciplined `invalidateTags`
  in mutations — under-invalidation shows stale data up to TTL, never wrong writes.

## 1.2 Kill the metrics N+1 / over-fetch (real bug)

`metrics.ts` pulls full rows and sums in JS. Replace with SQL aggregation.

```typescript
// src/lib/metrics.ts  — before: findMany + reduce
export async function salesRevenue(companyId: string, since?: Date): Promise<number> {
  const r = await prisma.sale.aggregate({
    _sum: { salePrice: true },
    where: { deal: { companyId, status: "CLOSED_WON", ...(since ? { closeDate: { gte: since } } : {}) } },
  });
  return Number(r._sum.salePrice ?? 0);
}

export async function commissionTotals(companyId: string) {
  const rows = await prisma.commissionShare.groupBy({
    by: ["paid"], _sum: { amount: true }, where: { commission: { companyId } },
  });
  let paid = 0, pending = 0;
  for (const g of rows) (g.paid ? (paid = Number(g._sum.amount ?? 0)) : (pending = Number(g._sum.amount ?? 0)));
  return { paid, pending, total: paid + pending };
}

// outstandingPayments: split the "overdue by status OR past-due-date" in SQL with two aggregates.
```

- **Test**: seed N deals, assert aggregate equals the old JS reduce (golden test against current impl).
- **Rollback**: trivial — revert the function bodies; signatures unchanged.
- **Perf**: `outstandingPayments` on a 50k-payment tenant goes from transferring 50k rows →
  2 scalar rows. **Memory + latency drop ~100×** at the high end; correctness identical.
- **Breaking**: none — same return shapes.

## 1.3 Keyset (cursor) pagination for large lists

Keep offset `parsePage` for small/admin lists; add keyset for leads/properties/payments/activity.

```typescript
// src/lib/pagination.ts  (add alongside parsePage)
export interface KeysetState { take: number; cursor?: { id: string; sortAt: Date } }

/** Decode an opaque `?after=` token (base64url of `ISO|id`). */
export function parseKeyset(sp: { after?: string; pageSize?: string }, defaultSize = DEFAULT_PAGE_SIZE): KeysetState {
  const take = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Number(sp.pageSize) || defaultSize));
  if (!sp.after) return { take };
  try {
    const [iso, id] = Buffer.from(sp.after, "base64url").toString().split("|");
    const sortAt = new Date(iso);
    if (id && !isNaN(sortAt.getTime())) return { take, cursor: { id, sortAt } };
  } catch { /* fall through */ }
  return { take };
}

export function encodeCursor(row: { id: string; createdAt: Date }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");
}
```

```typescript
// usage in a leads query — uses the existing [companyId, createdAt] index
const { take, cursor } = parseKeyset(searchParams);
const rows = await prisma.lead.findMany({
  where: { AND: [leadScope(user), cursor ? { OR: [
    { createdAt: { lt: cursor.sortAt } },
    { createdAt: cursor.sortAt, id: { lt: cursor.id } }, // tiebreak by id
  ] } : {}] },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: take + 1, // fetch one extra to know if there's a next page
});
const nextCursor = rows.length > take ? encodeCursor(rows[take - 1]) : null;
```

- **Test**: insert rows with duplicate `createdAt`, page through, assert no dupes/skips at the
  boundary (the `id` tiebreak is the thing under test).
- **Rollback**: keyset is additive; offset paths untouched. Remove the `?after=` UI control.
- **Perf**: page 200 of a 50k list goes from `OFFSET 4975` (scans 5k rows) → index seek.
  **Deep pages O(1) instead of O(offset).**
- **Breaking**: URL shape changes for migrated lists (`?after=` not `?page=`); keep both readers
  during transition. No API consumers depend on it (server-rendered).

## 1.4 Trigram search indexes (pg_trgm)

`search.ts` uses `ILIKE %term%` with no supporting index → seq scans. Add GIN trigram indexes.

```sql
-- migration: enable extension + GIN trigram indexes on the columns search.ts hits
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY idx_property_title_trgm   ON "Property" USING gin (title gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_property_area_trgm    ON "Property" USING gin (area  gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_client_name_trgm      ON "Client"   USING gin (name  gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_client_phone_trgm     ON "Client"   USING gin (phone gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_dealer_name_trgm      ON "Dealer"   USING gin (name  gin_trgm_ops);
-- reference/number are short & high-cardinality; existing btree + prefix match is fine.
```

Managed **outside `prisma db push`** (it can't express trigram GIN or `CONCURRENTLY`). Put in
`deploy/migrations/` and apply via the existing migration runner. No code change in `search.ts` —
Postgres now uses the index for the same `contains` queries.

- **Test**: `EXPLAIN ANALYZE` the search query pre/post — assert `Bitmap Index Scan` not `Seq Scan`.
- **Rollback**: `DROP INDEX CONCURRENTLY idx_*_trgm;` — pure index, no data change.
- **Perf**: cross-entity search on a 100k-property tenant: seq scan (~hundreds of ms) →
  index scan (single-digit ms).
- **Breaking**: none. Write amplification: 5 GIN indexes add ~small insert cost on
  Property/Client/Dealer — acceptable for read-heavy search.

## 1.5 Optimistic locking for Commission & Payment

No `version` column today (Document has one, for doc revisions — different concern). Add it and
guard financial writes with a compare-and-swap.

```prisma
// schema.prisma — add to Commission and Payment
model Commission { /* … */ version Int @default(0) }
model Payment    { /* … */ version Int @default(0) }
```

```typescript
// src/lib/concurrency.ts
export class ConcurrentUpdateError extends Error {
  constructor() { super("This record changed since you loaded it. Reload and retry."); }
}

/** Compare-and-swap: update only if version matches, then bump it.
 *  updateMany returns count=0 when the WHERE (incl. version) matched nothing. */
export async function casUpdate<T extends { id: string }>(
  model: { updateMany: (a: any) => Promise<{ count: number }> },
  id: string, expectedVersion: number, data: Record<string, unknown>,
): Promise<void> {
  const { count } = await model.updateMany({
    where: { id, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  if (count === 0) throw new ConcurrentUpdateError();
}
```

```typescript
// commission approval action — form carries the loaded version as a hidden field
await casUpdate(prisma.commission, id, Number(form.version), { status: "APPROVED", approvedById: user.id, approvedAt: new Date() });
// catch ConcurrentUpdateError -> return a flash: "Someone else updated this commission, reload."
```

- **Test**: two concurrent `casUpdate` with the same `expectedVersion` → exactly one succeeds,
  the other throws `ConcurrentUpdateError`.
- **Rollback**: drop the `version` columns; revert actions to plain `update`. Backfill default 0.
- **Perf**: negligible — same single UPDATE, now with `version` in the predicate (indexed by PK).
- **Breaking**: approval/payment forms must round-trip a `version` field. Missing field →
  treat as `0` only on first migration window, then require it.

## 1.6 Idempotency keys for financial mutations

Reuse the proven `Job (type, idempotencyKey)` pattern as a generic guard so a double-submitted
"record payment" / "approve commission" can't double-write.

```prisma
// schema.prisma — new model
model IdempotencyKey {
  id        String   @id @default(cuid())
  companyId String
  scope     String   // "payment.create", "commission.approve"
  key       String   // client-generated UUID per user action
  resultId  String?  // id of the row created, for replay
  createdAt DateTime @default(now())
  @@unique([companyId, scope, key])
  @@index([createdAt]) // for purge sweep
}
```

```typescript
// src/lib/idempotency.ts
import { prisma } from "@/lib/prisma";
/** Run `op` at most once per (company, scope, key). Replays return the prior resultId. */
export async function once<T extends { id: string }>(
  companyId: string, scope: string, key: string, op: () => Promise<T>,
): Promise<{ result: T | null; replayed: boolean; resultId: string }> {
  try {
    await prisma.idempotencyKey.create({ data: { companyId, scope, key } });
  } catch (e: any) {
    if (e.code === "P2002") { // unique violation = already ran
      const prior = await prisma.idempotencyKey.findUnique({ where: { companyId_scope_key: { companyId, scope, key } } });
      return { result: null, replayed: true, resultId: prior?.resultId ?? "" };
    }
    throw e;
  }
  const result = await op();
  await prisma.idempotencyKey.update({ where: { companyId_scope_key: { companyId, scope, key } }, data: { resultId: result.id } });
  return { result, replayed: false, resultId: result.id };
}
```

Generate the key client-side (`crypto.randomUUID()`) when the form mounts; submit it hidden.
Add `IdempotencyKey` rows >7 days to the existing `purgeOldRows` sweep.

- **Test**: call `once` twice with same key → `op` runs once, second is `replayed:true`.
- **Rollback**: drop the table; remove the wrapper (mutations revert to direct writes).
- **Perf**: +1 insert per financial mutation (cheap). The unique index does the dedup.
- **Breaking**: financial forms must carry an idempotency key field.

## 1.7 DB-level CHECK constraints for business rules

`prisma db push` won't emit these — apply as raw migration.

```sql
ALTER TABLE "Payment"        ADD CONSTRAINT chk_payment_amount_pos   CHECK (amount  >= 0);
ALTER TABLE "Commission"     ADD CONSTRAINT chk_comm_total_pos       CHECK ("totalAmount" >= 0);
ALTER TABLE "CommissionShare"ADD CONSTRAINT chk_share_pct_range      CHECK (pct >= 0 AND pct <= 100);
ALTER TABLE "Property"       ADD CONSTRAINT chk_prop_price_nonneg    CHECK (("salePrice" IS NULL OR "salePrice" >= 0) AND ("monthlyRent" IS NULL OR "monthlyRent" >= 0));
```

- **Test**: attempt a negative payment insert → expect `23514` check violation surfaced as a
  validation error (Prisma `P2010`/raw). Assert the server action maps it to a friendly flash.
- **Rollback**: `ALTER TABLE … DROP CONSTRAINT …`. Pre-flight: scan for existing violating rows
  before adding (constraint creation fails if data violates).
- **Perf**: negligible per-write check.
- **Breaking**: writes that previously slipped bad data now error — that's the point; ensure
  server actions catch and translate.

---

# TIER 2 — MEDIUM PRIORITY

## 2.1 Soft-delete with restore

Add a nullable `deletedAt` to the entities that warrant recovery (Lead, Property, Deal, Client,
Document). Filter it out by default in `scope.ts` (single choke point — preserves RBAC).

```prisma
model Lead { /* … */ deletedAt DateTime? @@index([companyId, deletedAt]) }
```
```typescript
// scope.ts — every scope already returns a where fragment; add the filter there
export function leadScope(user: SessionUser): Prisma.LeadWhereInput {
  const base = /* existing role logic */;
  return { AND: [base, { deletedAt: null }] }; // restore views pass { deletedAt: { not: null } }
}
```
Delete = `update { deletedAt: now() }`; restore = `update { deletedAt: null }`; a sweep hard-deletes
after 30 days. **Risk**: any query that bypasses `scope.ts` will see tombstones — the `$extends`
assertion guard (§4.4) is the safety net.

- **Rollback**: stop writing `deletedAt`; column is inert. Hard-delete sweep is opt-in.
- **Breaking**: counts/uniqueness now exclude tombstones — audit any `count()` that should include them.

## 2.2 Real-time notifications via SSE + Postgres LISTEN/NOTIFY

No WebSocket infra, no Redis — fits the constraint. Requires adding **`pg`** (node-postgres) for
one long-lived listener connection (Prisma can't `LISTEN`). Not an external service, just a lib.

```typescript
// src/lib/realtime/notify.ts — fire from notify() in activity.ts after insert
import { prisma } from "@/lib/prisma";
export async function publish(channel: string, payload: object) {
  // pg_notify is safe via Prisma raw; payload <8kb
  await prisma.$executeRawUnsafe(`SELECT pg_notify($1, $2)`, channel, JSON.stringify(payload));
}
```

```typescript
// src/lib/realtime/bus.ts — ONE shared LISTEN connection per process, fans out to subscribers
import { Client } from "pg";
type Sub = (msg: any) => void;
const subs = new Map<string, Set<Sub>>(); // key: `co:${companyId}:user:${userId}`
let client: Client | null = null;
async function ensure() {
  if (client) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("LISTEN app_events");
  client.on("notification", (n) => {
    const msg = JSON.parse(n.payload!);
    for (const fn of subs.get(msg.target) ?? []) fn(msg);
  });
}
export async function subscribe(target: string, fn: Sub) {
  await ensure(); (subs.get(target) ?? subs.set(target, new Set()).get(target)!).add(fn);
  return () => subs.get(target)?.delete(fn);
}
```

```typescript
// src/app/api/events/route.ts — SSE endpoint (web-standard ReadableStream, not Next-specific)
import { requireUser } from "@/lib/session";
import { subscribe } from "@/lib/realtime/bus";
export const runtime = "nodejs";
export async function GET() {
  const user = await requireUser();
  const target = `co:${user.companyId}:user:${user.id}`;
  let unsub = () => {};
  const stream = new ReadableStream({
    async start(c) {
      const enc = new TextEncoder();
      const send = (d: any) => c.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`));
      send({ type: "hello" });
      unsub = await subscribe(target, send);
      const ka = setInterval(() => c.enqueue(enc.encode(": ka\n\n")), 25_000); // keepalive
      // @ts-expect-error attach for cancel
      c._ka = ka;
    },
    cancel() { unsub(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
```

Client: `new EventSource("/api/events")` updates the unread badge / WhatsApp inbox live.
**PM2 caveat**: one listener connection per fork — fine at `instances: 1`. Behind nginx, disable
proxy buffering for `/api/events` (`proxy_buffering off;`).

- **Test**: integration — open SSE, `publish` to the target, assert client receives within 1s.
- **Rollback**: remove the route + bus; UI falls back to existing poll/refresh. Zero schema change.
- **Perf**: removes notification polling; one idle connection + cheap `NOTIFY` per event.
- **Breaking**: none (additive). Adds `pg` dependency.

## 2.3 Materialized view for analytics + refresh via the job queue

For the heaviest report aggregates, precompute per-company daily rollups.

```sql
CREATE MATERIALIZED VIEW mv_company_daily AS
SELECT d."companyId",
       date_trunc('day', d."closeDate") AS day,
       count(*) FILTER (WHERE d.status='CLOSED_WON')          AS deals_won,
       coalesce(sum(s."salePrice") FILTER (WHERE d.status='CLOSED_WON'),0) AS revenue
FROM "Deal" d LEFT JOIN "Sale" s ON s."dealId"=d.id
WHERE d."closeDate" IS NOT NULL
GROUP BY 1,2;
CREATE UNIQUE INDEX ON mv_company_daily ("companyId", day); -- enables CONCURRENTLY refresh
```

Refresh from a new job type `analytics.refresh` enqueued once/day by the tick (alongside existing
daily sweeps): `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_company_daily;`. Reports read the view;
"today" is topped up live from base tables so the MV being ≤24h stale doesn't matter.

- **Test**: refresh, assert MV sum matches a live aggregate for a known company/day.
- **Rollback**: `DROP MATERIALIZED VIEW`; reports fall back to live aggregates (§1.2 makes those cheap).
- **Perf**: multi-month report queries go from scanning Deal+Sale → indexed MV read.
- **Breaking**: none if reports keep a live-aggregate fallback for the current day.

## 2.4 AI: dynamic model selection + streaming + fallback

Single insertion point — `runAi`/`client.ts` already centralize the model.

```typescript
// src/lib/ai/client.ts — route by task complexity
export const AI_MODELS = { complex: "claude-opus-4-7", simple: "claude-sonnet-4-6" } as const;
export function pickModel(type: string): string {
  // reply drafts / classification are simple; owner-insight / next-action are complex
  return type === "LEAD_REPLY_DRAFT" || type === "WHATSAPP_INTENT" ? AI_MODELS.simple : AI_MODELS.complex;
}
```

```typescript
// fallback when primary is rate-limited (429) or overloaded (529)
async function createWithFallback(client, params) {
  try { return await client.messages.create(params); }
  catch (e: any) {
    if (e?.status === 429 || e?.status === 529) return client.messages.create({ ...params, model: AI_MODELS.simple });
    throw e;
  }
}
```

**Streaming** for long-form (owner insight): add `stream: true` and pipe through the same SSE
transport as §2.2, persisting the full text to `AiSuggestion` on completion (so the cache + token
accounting still work). **Cost anomaly detection**: a daily job sums `AiSuggestion` tokens per
company; if today > 3× trailing-7-day mean, `logActivity` + notify the owner. This reuses the
existing token columns — no new infra.

- **Test**: mock a 429 → assert fallback model is used and a suggestion still persists.
- **Rollback**: `pickModel` returns Opus unconditionally; remove fallback wrapper.
- **Perf/cost**: routing simple tasks to Sonnet cuts per-call cost materially at equal latency.
- **Breaking**: none (model id is internal). Verify both model ids against `claude-api` skill before shipping.

## 2.5 Input-hash normalization (the pragmatic "semantic" cache)

Instead of embeddings, normalize the AI input before hashing (lowercase, collapse whitespace,
round budgets to nearest 100k, drop volatile timestamps). Near-identical lead contexts then hit
the same `inputHash` row. ~80% of semantic-cache benefit, zero new dependency.

---

# TIER 3 — Observability & Scalability (lower priority)

## 3.1 Correlation IDs + structured logging (do this; skip full OTel for now)
- Generate a request id in `proxy.ts`, stash via `AsyncLocalStorage`, include in every log line
  and in `ActivityLog.meta`. A `log(level, msg, fields)` helper emits one JSON line per event.
- Admin perf dashboard reads from a lightweight `RequestTiming` table (sampled 1/N) or just parses
  PM2 logs. **Job-queue backlog alert**: in the tick, `count` QUEUED jobs; if >1000, `logActivity`
  + notify SUPER_ADMIN. Cheap, high-signal, fits existing machinery.

## 3.2 OpenTelemetry — *only* once a collector exists
- `@vercel/otel` or manual SDK, instrument Prisma + fetch. Deferred: no backend on the VPS today,
  and §3.1 covers the 80% need. Revisit when moving off single-box.

## 3.3 ActivityLog partitioning by month
```sql
-- convert to declarative range partitioning on createdAt; attach a new partition monthly via the tick.
-- ActivityLog is append-only and never auto-purged → the one table that genuinely needs this at scale.
```
- **Rollback**: partitioned + plain table are query-compatible; detach partitions to revert.

## 3.4 Read-replica strategy for reports
- Add `DATABASE_REPLICA_URL`; a second `PrismaClient` used **only** by `/reports` + MV reads.
  Wrap in `replicaPrisma` so write paths can't accidentally use it. No app logic change beyond the
  reports data layer. Deferred until report load justifies it.

## 3.5 Horizontal PM2 + DB-backed rate limiting
- The moment you set `instances: > 1`, the in-process `rate-limit.ts` and QueryOptimizer cache
  fragment per fork. Migration path: move rate limiting to a `RateLimitHit` table (or Postgres
  advisory locks / `pg` counters) — the call sites don't change (the file already documents this).
  Cache invalidation would need `pg_notify` fan-out (reuse §2.2 bus). Design now, build when needed.

## 3.6 Blob storage (S3-compatible)
- Abstract `uploads.ts` behind a `StorageDriver` interface (`put/get/delete/url`); current local-disk
  becomes `LocalDriver`, add `S3Driver` (R2/MinIO). `/api/files` and `/api/public/property-media`
  call the driver. Enables multi-box + offloads static serving. Deferred (single VPS disk is fine now).

---

## 4. Security hardening details (Tier 1 items expanded)

### 4.1 Progressive login lockout (extends existing limiter)
On repeated failures for an email, escalate the window: 5 fails → 1m, 10 → 5m, 15 → 30m. Track a
`failCount` in a tiny table or extend the bucket; reset on success (already done via `resetRateLimit`).

### 4.2 Typed sensitive-op audit wrapper (on top of `activity.ts`)
```typescript
// src/lib/audit.ts
const SENSITIVE = ["commission.approve","commission.reject","user.delete","user.suspend","payment.delete","company.plan_change"] as const;
export async function auditSensitive(action: typeof SENSITIVE[number], ctx: { companyId: string; userId: string; entityType: string; entityId: string; before?: unknown; after?: unknown; summary: string }) {
  await logActivity({ ...ctx, action, meta: { before: ctx.before, after: ctx.after, sensitive: true } });
}
```
Optionally make the trail tamper-evident: store `prevHash` (hash of the previous log row) so deletion
is detectable — cheap, no infra.

### 4.3 Same-origin assertion for custom route mutators
Server Actions are already CSRF-protected by Next. For the few `route.ts` POST handlers
(`/api/upload`, `/api/signout`), assert `Origin`/`Sec-Fetch-Site` matches host. Webhooks/cron are
exempt (they authenticate by HMAC/Bearer).

### 4.4 Tenant-isolation assertion guard (NOT auto-injection)
Replaces the deprecated `$use` RLS idea while honoring "preserve the existing scope system":
```typescript
// in prisma.ts $extends query hook — dev/staging hard-fail, prod warn+log
const TENANT_MODELS = new Set(["Lead","Property","Deal","Payment","Invoice","Commission",/*…*/]);
async function $allOperations({ model, operation, args, query }) {
  if (TENANT_MODELS.has(model ?? "") && /^(find|update|delete|count|aggregate|groupBy)/.test(operation)) {
    const w = (args as any)?.where ?? {};
    const scoped = JSON.stringify(w).includes("companyId") || JSON.stringify(w).includes("company");
    if (!scoped) { const msg = `[tenant-guard] ${model}.${operation} without companyId scope`;
      if (process.env.NODE_ENV !== "production") throw new Error(msg); else console.error(msg); }
  }
  return query(args);
}
```
Catches the failure mode RLS is meant to prevent (a query that forgot to scope) without overriding
the explicit, auditable `scope.ts` fragments. True Postgres RLS (`SET LOCAL app.company_id` per txn)
is the heavier alternative — list it as a Tier-3 option if you ever run untrusted query paths.

### 4.5 Session fingerprinting + IP anomaly
Bind a hash of `userAgent` (coarse — not full IP, which roams on mobile) into the JWT; on each
`requireUser`, if the fingerprint diverges, force re-auth. IP anomaly: log new-country logins to
`ActivityLog` and notify the owner — detection, not blocking (Pakistani mobile IPs are volatile).

---

## 5. Suggested sequencing (PR-sized units)

1. **PR1** — metrics aggregation rewrite (§1.2) + statement_timeout. *Pure win, no schema.*
2. **PR2** — QueryOptimizer + Prisma extension + tenant-guard (§1.1, §4.4).
3. **PR3** — trigram indexes (§1.4) + keyset pagination on leads/properties (§1.3).
4. **PR4** — optimistic locking + idempotency + CHECK constraints (§1.5–1.7). *One financial-integrity PR.*
5. **PR5** — sensitive-op audit + progressive lockout + same-origin assertion (§4.1–4.3).
6. **PR6** — SSE/LISTEN-NOTIFY notifications (§2.2).
7. **PR7** — AI model routing + fallback + cost anomaly (§2.4–2.5).
8. **PR8** — materialized view + analytics refresh job (§2.3).
9. **Later** — soft-delete, partitioning, replica, blob storage, OTel as load demands.

Each PR: `npm run typecheck && npm run test`, verify locally per `local-run-setup`, then push
(push == prod deploy). Raw SQL migrations go in `deploy/migrations/` and run via the existing
runner, **never** `prisma db push` (it can't express trigram GIN, CONCURRENTLY, CHECK, partitions,
or materialized views).
