-- Lead agent-filter index — supports the "filter pipeline by agent" feature.
--
-- The leads list, when filtered to one agent (or the "Unassigned" bucket),
-- runs:  WHERE companyId = ? AND agentId = ?  ORDER BY updatedAt DESC  LIMIT n
-- with keyset paging. The composite below turns that into a single index seek
-- (EXPLAIN shows an Index Scan Backward with no Sort) at any page depth, and
-- the same index serves the agentId IS NULL "unassigned" query.
--
-- Prisma's default DDL builds this WITHOUT CONCURRENTLY, which briefly blocks
-- writes on Lead while the index is built. On a hot/large Lead table, run this
-- script BEFORE `prisma db push` so the index is already present and Prisma
-- sees it as a no-op:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-10-lead-agent-index.sql
--   npx prisma db push        # recognises the index, skips it
--
-- CONCURRENTLY must run outside a transaction block, so the statement stands
-- alone. IF NOT EXISTS makes it idempotent — safe to re-run, and a no-op on a
-- database where `prisma db push` already created the index (same name).
--
-- Rollback:  DROP INDEX CONCURRENTLY IF EXISTS "Lead_companyId_agentId_updatedAt_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "Lead_companyId_agentId_updatedAt_idx"
  ON "Lead" ("companyId", "agentId", "updatedAt");

-- Verify the planner uses it once the table is large enough to prefer a seek
-- over a sort (on a small table it may still bitmap-scan Lead_agentId_idx):
--
--   EXPLAIN SELECT id FROM "Lead"
--   WHERE "companyId" = '<cid>' AND "agentId" = '<aid>'
--   ORDER BY "updatedAt" DESC LIMIT 21;   -- expect Index Scan Backward, no Sort
--
-- Check for an INVALID index left by a failed CONCURRENTLY build:
--   SELECT i.relname, ix.indisvalid FROM pg_class i
--   JOIN pg_index ix ON ix.indexrelid = i.oid WHERE NOT ix.indisvalid;
