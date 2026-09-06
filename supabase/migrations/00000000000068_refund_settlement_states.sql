-- REFUND-1: refund states on a settled job.
--
-- `settlement_state` (migration 57) was added for FEE-10 and admits only the
-- two reversal values. A refund the trade initiates is not a reversal — nobody
-- disputed anything — so it needs states of its own:
--
--   refunded              - the whole settlement has been returned
--   partially_refunded    - part returned, more still refundable
--
-- 'settled' is deliberately NOT added. Nothing in the tree writes it, and a
-- state nothing writes is a gate nothing passes: keying refund eligibility off
-- it would have made the feature unreachable in production. A job is settled
-- when `jobs.paid_at` is set, which is what settle-paid-job.ts actually does,
-- and that is what src/lib/refund-settlement.ts reads.
--
-- The reversal values stay admitted unchanged. countsAsFutureRevenue() in
-- settlement-reversal.ts tests for those two by name, so the refund states
-- correctly count as future revenue: the motko service fee is NOT returned on
-- a refund (REVERSAL_CLAUSE.serviceFee), so it is still owed.
--
-- ROLLBACK: alter table jobs drop constraint jobs_settlement_state_check;
--           alter table jobs add constraint jobs_settlement_state_check
--             check (settlement_state in ('reversed_after_settlement', 'reversed_before_settlement'));
--           alter table jobs drop column total_refunded_pennies;

alter table jobs drop constraint if exists jobs_settlement_state_check;

alter table jobs
  add constraint jobs_settlement_state_check
    check (settlement_state in (
      'reversed_after_settlement',
      'reversed_before_settlement',
      'refunded',
      'partially_refunded'
    ));

comment on column jobs.settlement_state is
  'Settlement state. Null for a job that has neither been reversed nor refunded — including a normally settled one, whose settlement is recorded by jobs.paid_at. Values: reversed_after_settlement (chargeback after the fee was charged), reversed_before_settlement (chargeback before it was), refunded (the trade returned the whole payment), partially_refunded (the trade returned part of it).';

-- Integer PENNIES, matching fee_amount_pennies and the amounts Stripe deals in.
-- Deliberately not a numeric-pounds column like invoices.amount / quotes.total:
-- every value written here is read straight back to and from the Stripe API,
-- and a unit conversion in that path is a 100x error waiting to happen.
--
-- A cache, not the source of truth. Stripe's own refund list is authoritative
-- and is what refund-settlement.ts computes the refundable ceiling from; this
-- column exists so the job page and the fees statement can show the position
-- without an API call.
alter table jobs add column total_refunded_pennies int;

comment on column jobs.total_refunded_pennies is
  'Total refunded across all refunds on this job, in integer pennies. Null when nothing has been refunded. A cache of Stripe''s refund list, which remains the source of truth.';
