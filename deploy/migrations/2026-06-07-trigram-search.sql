-- Trigram search indexes (PR3) — make GlobalSearch's ILIKE queries indexable.
--
-- src/lib/search.ts filters with `{ contains: term, mode: "insensitive" }`,
-- which compiles to `column ILIKE '%term%'`. A leading wildcard can't use a
-- btree, so today these are sequential scans that grow linearly with tenant
-- size. pg_trgm GIN indexes make substring ILIKE an index scan.
--
-- Prisma can't express GIN/trigram or CONCURRENTLY, so this runs OUTSIDE
-- `prisma db push` (which then sees nothing to do for these). Apply BEFORE the
-- deploy, as its own step:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-07-trigram-search.sql
--
-- CONCURRENTLY must run outside a transaction block, so each statement stands
-- alone. IF NOT EXISTS makes the script idempotent.
--
-- Rollback:  DROP INDEX CONCURRENTLY IF EXISTS idx_<name>_trgm;  (per index)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Property: search.ts matches title, area (also reference/city, but those are
-- short/high-cardinality and served fine by prefix/btree — index the wide
-- free-text columns only to keep write amplification down).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_title_trgm
  ON "Property" USING gin (title gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_area_trgm
  ON "Property" USING gin (area gin_trgm_ops);

-- Client: name + phone are the search columns (email is exact-ish, skip).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_name_trgm
  ON "Client" USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_phone_trgm
  ON "Client" USING gin (phone gin_trgm_ops);

-- Dealer: name + companyName.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dealer_name_trgm
  ON "Dealer" USING gin (name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dealer_companyname_trgm
  ON "Dealer" USING gin ("companyName" gin_trgm_ops);

-- Verify the planner now uses them:
--   EXPLAIN ANALYZE SELECT id FROM "Property"
--   WHERE title ILIKE '%clifton%';        -- expect Bitmap Index Scan, not Seq Scan
--
-- Check for INVALID indexes left by a failed CONCURRENTLY build:
--   SELECT i.relname, ix.indisvalid FROM pg_class i
--   JOIN pg_index ix ON ix.indexrelid = i.oid WHERE NOT ix.indisvalid;
