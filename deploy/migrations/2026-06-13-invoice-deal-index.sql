-- Invoice.dealId index — make the deal-detail invoice list an index seek.
--
-- deals/[id] does `include: { invoices: { orderBy: { issuedAt: "desc" } } }`,
-- compiling to `Invoice WHERE dealId = ?`. dealId was unindexed, so every
-- deal-detail view scanned the Invoice table (and the SetNull on deal deletion
-- scanned too). Mirrors Payment.dealId / Document.dealId.
--
-- Invoice is an existing, non-empty table, so Prisma's default (non-CONCURRENT)
-- index build would briefly lock writes. Run this BEFORE `prisma db push` so the
-- index is already present and Prisma sees it as a no-op:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-13-invoice-deal-index.sql
--   npx prisma db push        # recognises the index, skips it
--
-- CONCURRENTLY must run outside a transaction block, so the statement stands
-- alone. IF NOT EXISTS makes it idempotent — safe to re-run, and a no-op once
-- `prisma db push` has already created the index under the same name.
--
-- Rollback:  DROP INDEX CONCURRENTLY IF EXISTS "Invoice_dealId_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "Invoice_dealId_idx" ON "Invoice" ("dealId");

-- Verify:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'Invoice' AND indexname = 'Invoice_dealId_idx';
--
-- Check for an INVALID index left by a failed CONCURRENTLY build:
--   SELECT i.relname, ix.indisvalid FROM pg_class i
--   JOIN pg_index ix ON ix.indexrelid = i.oid WHERE NOT ix.indisvalid;
