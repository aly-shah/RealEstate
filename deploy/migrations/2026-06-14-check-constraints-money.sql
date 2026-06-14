-- Business-rule CHECK constraints, round 2 — extend the money/percentage
-- invariants from 2026-06-07-check-constraints.sql to the fields it missed plus
-- the ones added since (Deal.grossCommissionPercentage, the Contract model).
-- Same rationale: enforce "no negative money, percentages 0–100" at the DB so a
-- bug in any code path can't persist nonsensical values.
--
-- Prisma can't express CHECK constraints, so this runs OUTSIDE `prisma db push`
-- (which leaves them untouched). Apply AFTER the schema push so the columns
-- exist. Run:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-14-check-constraints-money.sql
--
-- PRE-FLIGHT: adding a CHECK fails if existing rows violate it. All of these
-- must return 0 before running (verified 0 on the dev DB at authoring time):
--   SELECT count(*) FROM "Deal"           WHERE "grossCommissionPercentage" < 0 OR "grossCommissionPercentage" > 100;
--   SELECT count(*) FROM "Invoice"         WHERE amount < 0;
--   SELECT count(*) FROM "Sale"            WHERE "salePrice" < 0 OR coalesce("tokenAmount",0) < 0 OR coalesce("bookingAmount",0) < 0 OR coalesce("downPayment",0) < 0;
--   SELECT count(*) FROM "Rental"          WHERE "monthlyRent" < 0 OR coalesce(deposit,0) < 0;
--   SELECT count(*) FROM "Contract"        WHERE "monthlyRent" < 0 OR deposit < 0;
--   SELECT count(*) FROM "CommissionRule"  WHERE "mainAgentPct" < 0 OR "mainAgentPct" > 100 OR "companyPct" < 0 OR "companyPct" > 100 OR "otherAgentPct" < 0 OR "otherAgentPct" > 100 OR "dealerPct" < 0 OR "dealerPct" > 100;
--
-- Each ADD is preceded by DROP ... IF EXISTS so the script is idempotent.
-- CHECK passes on NULL (only FALSE fails), so nullable columns are written
-- explicitly as "(col IS NULL OR col >= 0)" for readability.

-- Deal: gross commission is a percentage (mirrors CommissionShare.pct).
ALTER TABLE "Deal" DROP CONSTRAINT IF EXISTS chk_deal_gcpct_range;
ALTER TABLE "Deal"
  ADD CONSTRAINT chk_deal_gcpct_range
  CHECK ("grossCommissionPercentage" >= 0 AND "grossCommissionPercentage" <= 100);

-- Invoice: amount is money (mirrors Payment.amount).
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS chk_invoice_amount_nonneg;
ALTER TABLE "Invoice"
  ADD CONSTRAINT chk_invoice_amount_nonneg CHECK (amount >= 0);

-- Sale: every captured figure is money.
ALTER TABLE "Sale" DROP CONSTRAINT IF EXISTS chk_sale_amounts_nonneg;
ALTER TABLE "Sale"
  ADD CONSTRAINT chk_sale_amounts_nonneg CHECK (
    "salePrice" >= 0 AND
    ("tokenAmount"   IS NULL OR "tokenAmount"   >= 0) AND
    ("bookingAmount" IS NULL OR "bookingAmount" >= 0) AND
    ("downPayment"   IS NULL OR "downPayment"   >= 0)
  );

-- Rental: rent + deposit are money.
ALTER TABLE "Rental" DROP CONSTRAINT IF EXISTS chk_rental_amounts_nonneg;
ALTER TABLE "Rental"
  ADD CONSTRAINT chk_rental_amounts_nonneg CHECK (
    "monthlyRent" >= 0 AND (deposit IS NULL OR deposit >= 0)
  );

-- Contract: frozen rent + deposit snapshot (both NOT NULL).
ALTER TABLE "Contract" DROP CONSTRAINT IF EXISTS chk_contract_amounts_nonneg;
ALTER TABLE "Contract"
  ADD CONSTRAINT chk_contract_amounts_nonneg CHECK (
    "monthlyRent" >= 0 AND deposit >= 0
  );

-- CommissionRule: the four split percentages (mirrors CommissionShare.pct).
ALTER TABLE "CommissionRule" DROP CONSTRAINT IF EXISTS chk_rule_pcts_range;
ALTER TABLE "CommissionRule"
  ADD CONSTRAINT chk_rule_pcts_range CHECK (
    "mainAgentPct"  >= 0 AND "mainAgentPct"  <= 100 AND
    "companyPct"    >= 0 AND "companyPct"    <= 100 AND
    "otherAgentPct" >= 0 AND "otherAgentPct" <= 100 AND
    "dealerPct"     >= 0 AND "dealerPct"     <= 100
  );

-- Verify:
--   SELECT conname, conrelid::regclass FROM pg_constraint
--   WHERE conname LIKE 'chk_%' ORDER BY conname;
