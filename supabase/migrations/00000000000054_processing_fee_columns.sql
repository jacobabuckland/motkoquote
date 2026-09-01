-- FEE-7: Add processing fee columns to track Stripe's processing cost
-- These columns store estimated, actual, and delta processing fees for Stripe payments.
-- All are nullable because:
--   - Existing jobs have no values (backfilled as null)
--   - Off-rail payments (manual "mark as paid") never have processing fees

ALTER TABLE jobs
  ADD COLUMN processing_fee_estimated_pennies integer,
  ADD COLUMN processing_fee_actual_pennies integer,
  ADD COLUMN processing_fee_delta_pennies integer;

COMMENT ON COLUMN jobs.processing_fee_estimated_pennies IS
  'Estimated Stripe processing fee charged at payment creation, based on configured rate + fixed + cap';

COMMENT ON COLUMN jobs.processing_fee_actual_pennies IS
  'Actual Stripe processing fee from balance_transaction.fee, populated on settlement';

COMMENT ON COLUMN jobs.processing_fee_delta_pennies IS
  'Difference between actual and estimated processing fees (actual - estimated), alerts when exceeds threshold';
