-- REFUND-1: Widen settlement_state to include refund states
--
-- The existing settlement_state column (migration 57) only allows reversal
-- states. REFUND-1 adds full and partial refund capability, which requires
-- three additional states:
--
--   settled               - payment settled, not yet refunded
--   refunded              - fully refunded
--   partially_refunded    - one or more partial refunds issued, more refundable
--
-- These are distinct from reversals (chargebacks/disputes that Stripe initiated)
-- in that refunds are merchant-initiated returns via Stripe's refunds API.
--
-- ROLLBACK: alter table jobs drop constraint jobs_settlement_state_check;
--           alter table jobs add constraint jobs_settlement_state_check
--             check (settlement_state in ('reversed_after_settlement', 'reversed_before_settlement'));

-- Drop the existing constraint
alter table jobs drop constraint if exists jobs_settlement_state_check;

-- Add the widened constraint
alter table jobs
  add constraint jobs_settlement_state_check
    check (settlement_state in (
      'reversed_after_settlement',
      'reversed_before_settlement',
      'settled',
      'refunded',
      'partially_refunded'
    ));

comment on column jobs.settlement_state is
  'Settlement and refund state. Null for jobs not yet settled. Values: reversed_after_settlement (chargeback after fee charged), reversed_before_settlement (chargeback before fee charged), settled (paid and not refunded), refunded (fully refunded), partially_refunded (one or more partial refunds issued).';

-- Add column to track total refunded amount across partial refunds
-- Nullable: null means no refunds have been issued
alter table jobs add column total_refunded_pennies int;

comment on column jobs.total_refunded_pennies is
  'Total amount refunded across all partial refunds (in pennies). Null if no refunds have been issued. Used to enforce total-refunded-never-exceeds-settlement constraint.';
