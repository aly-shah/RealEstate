-- Document FK indexes — make the detail-page document lists index seeks.
--
-- deals/[id], dealers/[id] and properties/[id] all `include: { documents: true }`,
-- which compiles to `Document WHERE <fk> = ?`. propertyId was already indexed;
-- dealId + dealerId were not, so those two pages did a tenant-wide scan (and the
-- SetNull on deal/dealer deletion scanned too). The new rental-contract flow also
-- writes CNIC Documents linked by dealId, so the deal page leans on this.
--
-- Document is an existing, non-empty table, so Prisma's default (non-CONCURRENT)
-- index build would briefly lock writes. Run this BEFORE `prisma db push` so the
-- indexes are already present and Prisma sees them as a no-op:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-13-document-fk-indexes.sql
--   npx prisma db push        # recognises the indexes, skips them
--
-- CONCURRENTLY must run outside a transaction block, so each statement stands
-- alone. IF NOT EXISTS makes it idempotent — safe to re-run, and a no-op once
-- `prisma db push` has already created the indexes under the same names.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS "Document_dealId_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Document_dealerId_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "Document_dealId_idx" ON "Document" ("dealId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "Document_dealerId_idx" ON "Document" ("dealerId");

-- Verify:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'Document' AND indexname LIKE 'Document_deal%';
--
-- Check for an INVALID index left by a failed CONCURRENTLY build:
--   SELECT i.relname, ix.indisvalid FROM pg_class i
--   JOIN pg_index ix ON ix.indexrelid = i.oid WHERE NOT ix.indisvalid;
