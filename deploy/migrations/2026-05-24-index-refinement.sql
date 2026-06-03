-- Schema refinement #6 — index hygiene (Phase 10 follow-up).
--
-- Run this BEFORE `prisma db push` against production. Prisma's default
-- index DDL omits CONCURRENTLY, which would briefly block writes on the
-- ActivityLog table while the new 4-column composite is built. This script
-- does every change with CONCURRENTLY so writers keep flowing.
--
-- Postgres requires CONCURRENTLY operations to run OUTSIDE a transaction
-- block, so each statement stands alone. Run via:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-05-24-index-refinement.sql
--
-- After this succeeds, `prisma db push` is a no-op for these indexes
-- (Prisma sees them present and skips). Verify with `\d "ActivityLog"` etc.
--
-- Safety notes
--   * CONCURRENTLY can ROLLBACK partially if the build fails — the
--     resulting index is marked INVALID; drop it and rerun.
--   * IF [NOT] EXISTS makes this script idempotent — re-running is safe.
--   * No data migration; pure index metadata changes.

-- ─────────────────────────────────────────────────────────── ActivityLog

-- New composite that fully covers the lead-detail timeline query
-- (WHERE companyId AND entityType AND entityId ORDER BY createdAt DESC).
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "ActivityLog_companyId_entityType_entityId_createdAt_idx"
  ON "ActivityLog" ("companyId", "entityType", "entityId", "createdAt");

-- Drop the predecessor only after the new one exists so the planner can
-- pivot mid-flight without ever losing index coverage on the path.
DROP INDEX CONCURRENTLY IF EXISTS "ActivityLog_entityType_entityId_idx";

-- ─────────────────────────────────────────────────────────── Document

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "Document_companyId_expiryDate_idx"
  ON "Document" ("companyId", "expiryDate");

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "Document_companyId_createdAt_idx"
  ON "Document" ("companyId", "createdAt");

DROP INDEX CONCURRENTLY IF EXISTS "Document_expiryDate_idx";

-- ─────────────────────────────────────────────────────────── User

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  "User_companyId_role_idx"
  ON "User" ("companyId", "role");

-- ─────────────────────────────────────────────────────────── Drops only
-- These had no replacement — the composites that cover them
-- (Lead.[companyId,stage,updatedAt], Property.[companyId,status],
--  Deal.[companyId,closeDate], Payment.[companyId,dueDate]) already
-- existed before this refinement, so dropping is safe immediately.

DROP INDEX CONCURRENTLY IF EXISTS "Lead_stage_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Property_status_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Deal_status_idx";
DROP INDEX CONCURRENTLY IF EXISTS "Payment_status_idx";

-- ─────────────────────────────────────────────────────────── Verification

-- After the script completes, eyeball the index list — every entry below
-- should appear; none of the dropped ones should:
--
--   SELECT tablename, indexname FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND tablename IN ('ActivityLog','Document','User','Lead','Property','Deal','Payment')
--   ORDER BY tablename, indexname;
--
-- An INVALID index lingers as a build artefact if CONCURRENTLY failed:
--
--   SELECT i.relname, ix.indisvalid
--   FROM pg_class i
--   JOIN pg_index ix ON ix.indexrelid = i.oid
--   WHERE NOT ix.indisvalid;
--
-- If any appears, drop it with DROP INDEX CONCURRENTLY and rerun this script.
