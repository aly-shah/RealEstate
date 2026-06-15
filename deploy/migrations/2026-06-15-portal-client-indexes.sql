-- Deal.clientId + Showing.clientId indexes — make the client portal's per-client
-- lists index seeks.
--
-- The login-free client portal (portal/[token]) introduced queries that filter
-- these tables by clientId for the first time:
--   - portal page:  Deal    WHERE companyId, clientId   (deals + payments)
--                   Showing WHERE companyId, clientId   (shortlist properties)
--   - media proxy:  Showing WHERE companyId, clientId, propertyId
-- clientId is a (nullable) FK on both, but neither indexed it, so each portal
-- view full-scanned Deal/Showing filtered on companyId alone. Mirrors
-- Lead.clientId, which indexes it for exactly this "rows for client X" pattern.
-- The index also serves the SetNull when a Client is deleted.
--
-- Deal and Showing are existing, non-empty tables, so Prisma's default
-- (non-CONCURRENT) index build would briefly lock writes. Run this BEFORE
-- `prisma db push` so the indexes are already present and Prisma sees a no-op:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-15-portal-client-indexes.sql
--   npx prisma db push        # recognises the indexes, skips them
--
-- CONCURRENTLY must run outside a transaction block, so each statement stands
-- alone. IF NOT EXISTS makes them idempotent — safe to re-run, and a no-op once
-- `prisma db push` has already created the indexes under the same names.
--
-- Rollback:  DROP INDEX CONCURRENTLY IF EXISTS "Deal_clientId_idx";
--            DROP INDEX CONCURRENTLY IF EXISTS "Showing_clientId_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "Deal_clientId_idx" ON "Deal" ("clientId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "Showing_clientId_idx" ON "Showing" ("clientId");

-- Verify:
--   SELECT tablename, indexname FROM pg_indexes
--   WHERE indexname IN ('Deal_clientId_idx', 'Showing_clientId_idx');
--
-- Check for an INVALID index left by a failed CONCURRENTLY build:
--   SELECT i.relname, ix.indisvalid FROM pg_class i
--   JOIN pg_index ix ON ix.indexrelid = i.oid WHERE NOT ix.indisvalid;
