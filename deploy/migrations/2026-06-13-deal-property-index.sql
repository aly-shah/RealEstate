-- Deal.propertyId index — make the property-detail deal list an index seek.
--
-- properties/[id] does `include: { deals: true }`, compiling to
-- `Deal WHERE propertyId = ?`. propertyId is a required FK but was unindexed, so
-- every property-detail view full-scanned the Deal table (and the Deal→Property
-- relation lookups scanned too). Mirrors Lead/Showing/Document.propertyId, all of
-- which index it for the same reason.
--
-- Deal is an existing, non-empty table, so Prisma's default (non-CONCURRENT)
-- index build would briefly lock writes. Run this BEFORE `prisma db push` so the
-- index is already present and Prisma sees it as a no-op:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-13-deal-property-index.sql
--   npx prisma db push        # recognises the index, skips it
--
-- CONCURRENTLY must run outside a transaction block, so the statement stands
-- alone. IF NOT EXISTS makes it idempotent — safe to re-run, and a no-op once
-- `prisma db push` has already created the index under the same name.
--
-- Rollback:  DROP INDEX CONCURRENTLY IF EXISTS "Deal_propertyId_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "Deal_propertyId_idx" ON "Deal" ("propertyId");

-- Verify:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'Deal' AND indexname = 'Deal_propertyId_idx';
--
-- Check for an INVALID index left by a failed CONCURRENTLY build:
--   SELECT i.relname, ix.indisvalid FROM pg_class i
--   JOIN pg_index ix ON ix.indexrelid = i.oid WHERE NOT ix.indisvalid;
