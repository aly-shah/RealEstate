-- Business-rule CHECK constraints (PR4) — enforce invariants at the DB so a
-- bug in any code path can't persist nonsensical money/percentages.
--
-- Prisma can't express CHECK constraints, so this runs OUTSIDE `prisma db push`
-- (which leaves them untouched). Apply AFTER the schema push so the columns
-- exist. Run:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-07-check-constraints.sql
--
-- PRE-FLIGHT: adding a CHECK fails if existing rows violate it. Scan first:
--   SELECT count(*) FROM "Payment"         WHERE amount < 0;
--   SELECT count(*) FROM "Commission"      WHERE "totalAmount" < 0;
--   SELECT count(*) FROM "CommissionShare" WHERE pct < 0 OR pct > 100;
--   SELECT count(*) FROM "Property"
--     WHERE ("salePrice" IS NOT NULL AND "salePrice" < 0)
--        OR ("monthlyRent" IS NOT NULL AND "monthlyRent" < 0);
-- All must return 0 before running. (NOT VALID + VALIDATE is the zero-downtime
-- variant if a large table needs it; these are small enough to add inline.)
--
-- Rollback (per constraint):
--   ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS chk_payment_amount_nonneg;

ALTER TABLE "Payment"
  ADD CONSTRAINT chk_payment_amount_nonneg CHECK (amount >= 0);

ALTER TABLE "Commission"
  ADD CONSTRAINT chk_commission_total_nonneg CHECK ("totalAmount" >= 0);

ALTER TABLE "CommissionShare"
  ADD CONSTRAINT chk_share_pct_range CHECK (pct >= 0 AND pct <= 100);

ALTER TABLE "Property"
  ADD CONSTRAINT chk_property_price_nonneg CHECK (
    ("salePrice"   IS NULL OR "salePrice"   >= 0) AND
    ("monthlyRent" IS NULL OR "monthlyRent" >= 0)
  );

-- Verify:
--   SELECT conname, conrelid::regclass FROM pg_constraint
--   WHERE conname LIKE 'chk_%' ORDER BY conname;
