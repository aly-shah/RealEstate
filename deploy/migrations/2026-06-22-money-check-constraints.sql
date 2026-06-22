-- Business-rule CHECK constraints, round 3 (PR9) — the one money column the
-- earlier rounds missed: CommissionShare.amount.
--
-- Rounds 1–2 (2026-06-07, 2026-06-14) constrained every other money/percentage
-- field — Payment.amount, Commission.totalAmount, CommissionShare.PCT,
-- Property/Sale/Rental/Contract amounts, Deal.grossCommissionPercentage and the
-- CommissionRule split percentages. But the per-recipient *amount* on a
-- CommissionShare was left unconstrained: a split is computed in code (deal GCI
-- × a rule percentage), so a future bug or a manual adjustment could in
-- principle persist a negative payout. This closes that last gap.
--
-- Same mechanics as the prior rounds: Prisma can't express CHECK constraints, so
-- this runs OUTSIDE `prisma db push` (which leaves it untouched). Apply AFTER the
-- schema push. Idempotent via DROP ... IF EXISTS before ADD.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f deploy/migrations/2026-06-22-money-check-constraints.sql
--
-- PRE-FLIGHT (must return 0 — verified 0 on local + prod at authoring time):
--   SELECT count(*) FROM "CommissionShare" WHERE amount < 0;
--
-- Rollback:
--   ALTER TABLE "CommissionShare" DROP CONSTRAINT IF EXISTS chk_share_amount_nonneg;

-- CommissionShare: the per-recipient payout is money (mirrors Payment.amount).
ALTER TABLE "CommissionShare" DROP CONSTRAINT IF EXISTS chk_share_amount_nonneg;
ALTER TABLE "CommissionShare"
  ADD CONSTRAINT chk_share_amount_nonneg CHECK (amount >= 0);

-- Verify:
--   SELECT conname, conrelid::regclass FROM pg_constraint
--   WHERE conname LIKE 'chk_%' ORDER BY conname;
