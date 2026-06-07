-- Schema refinement — index for the PR1 outstanding-payments aggregates.
--
-- The rewritten lib/metrics.ts `outstandingPayments` filters Payment by
-- (companyId, status) for its count + both money sums. `prisma db push` would
-- create this index WITHOUT CONCURRENTLY, briefly blocking writes on the
-- Payment table while it builds. Run this first so the build is concurrent;
-- `prisma db push` then sees the index present and skips it.
--
-- The IdempotencyKey table + its company FK are brand new (created fresh by
-- `prisma db push`), so they need no pre-migration here.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-07-schema-refine-indexes.sql
--
-- CONCURRENTLY must run outside a transaction; the statement stands alone.
-- IF NOT EXISTS makes it idempotent.
--
-- Rollback:  DROP INDEX CONCURRENTLY IF EXISTS "Payment_companyId_status_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_companyId_status_idx"
  ON "Payment" ("companyId", "status");

-- Verify (and check for an INVALID index from a failed concurrent build):
--   \d "Payment"
--   SELECT i.relname, ix.indisvalid FROM pg_class i
--   JOIN pg_index ix ON ix.indexrelid = i.oid WHERE NOT ix.indisvalid;
