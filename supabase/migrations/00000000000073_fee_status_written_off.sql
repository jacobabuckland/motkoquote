-- CLEAN-3: write off every accrued service fee.
--
-- The service fee does not exist under the current commercial model (D1), so
-- every `fee_status = 'accrued'` row is uncollectable by design. This retires
-- them without destroying the record of what happened.
--
-- WHY THIS IS A MIGRATION AND NOT A FACTORY ITEM. Exactly one place in the
-- runtime reads the accrued state — `fees-statement-section.tsx:56`, which
-- queries `.eq("fee_status", "accrued")` and renders the total. Moving the rows
-- out of 'accrued' empties that query on its own. There is no code change, so
-- no acceptance test can fail before the work and pass after it, and three
-- successive derivations of #642 were correctly blocked for writing tests that
-- passed against a clean tree. The item is a data change; it is applied by
-- hand, like CLEAN-6 and SUB-3.
--
-- WHY A NEW VALUE RATHER THAN REUSING 'not_applicable'. `fee-copy.ts:99`
-- documents 'not_applicable' as THE FREE ALLOWANCE. Folding written-off fees
-- into it would describe eight charged jobs to the trade as free-allowance
-- jobs — a false statement about money on a surface a trade reads. The extra
-- value costs one migration and keeps the statement able to tell the truth.
--
-- WHAT IS DELIBERATELY NOT TOUCHED:
--   * `fee_amount_pennies` — left intact on every row. The write-off is a state
--     change, not a deletion; what was owed stays legible.
--   * `fee_status = 'collected'` — production carries exactly one such row
--     (200p). That is real money Stripe already took at source. It is not
--     accrued and must survive, visibly, on the statement.
--   * New jobs. This retires what has already accrued; stopping fresh accrual
--     is CLEAN-6, which is hand-implemented separately.
--
-- MEASURED ON PRODUCTION IMMEDIATELY BEFORE WRITING THIS (6 Sep 2026):
--   accrued         8 jobs   2200p   (£22.00)  <- these move
--   collected       1 job     200p   (£2.00)   <- untouched
--   not_applicable 52 jobs      0p             <- untouched
--
-- ROLLBACK:
--   update jobs set fee_status = 'accrued' where fee_status = 'written_off';
--   alter table jobs drop constraint jobs_fee_status_check;
--   alter table jobs add constraint jobs_fee_status_check
--     check (fee_status in ('not_applicable','accrued','collected','waived_refund'));

-- 1. Admit the new value. The existing constraint is the one migration 23
--    created inline on `add column`, hence the generated name.
alter table jobs drop constraint jobs_fee_status_check;

alter table jobs add constraint jobs_fee_status_check
  check (fee_status in ('not_applicable', 'accrued', 'collected', 'waived_refund', 'written_off'));

-- 2. Retire every accrued fee. Scoped to 'accrued' explicitly rather than to a
--    row count or an id list, so re-running is a no-op and so a row that accrues
--    between writing and applying is caught rather than missed.
update jobs
   set fee_status = 'written_off'
 where fee_status = 'accrued';

comment on column jobs.fee_status is
  'not_applicable = free allowance; accrued = owed and uncollected; collected = taken at source by Stripe; waived_refund = waived because the job was refunded; written_off = uncollectable under the current commercial model, retired by CLEAN-3 (migration 73). fee_amount_pennies survives on written-off rows.';
