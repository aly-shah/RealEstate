-- Statement timeout — bound runaway queries (PR1).
--
-- A single slow/locked query shouldn't tie up a connection indefinitely.
-- This sets a hard ceiling on the app role so any statement exceeding it is
-- cancelled by Postgres (error code 57014). The QueryOptimizer.withTimeout()
-- JS race only *abandons* a promise — it can't cancel the underlying query —
-- so this server-side limit is the real enforcement.
--
-- Run against production (psql, as a superuser or the role owner):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-07-statement-timeout.sql
--
-- The change is per-role and takes effect on the NEXT connection (existing
-- pooled connections keep the old value until recycled). 8s is comfortably
-- above every legitimate query in the app (the heaviest report aggregates run
-- in tens of ms) while catching genuine pathology.
--
-- NOTE: replace `re` below with the actual DATABASE_URL role if different.
-- Rollback:  ALTER ROLE re RESET statement_timeout;

ALTER ROLE re SET statement_timeout = '8s';

-- Verify (reconnect first, since SET-on-role applies to new sessions):
--   SHOW statement_timeout;   -- expect: 8s
