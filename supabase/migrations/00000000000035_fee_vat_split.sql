-- VAT-inclusive split of the motko fee.
--
-- motko is VAT-registered, so the flat £2/£4 fee is VAT-*inclusive*: the amount
-- charged (jobs.fee_amount_pennies / fee_collections.total_pennies) is unchanged
-- and remains what we collect. These columns record the net + VAT breakdown of
-- that same gross so the trade's fee statement (and, later, a VAT invoice) can
-- show it. Invariant: net + vat == gross, always (see splitFeeVat in
-- src/lib/motko-fee.ts, which computes them at accrual/collection).
--
-- All amounts are in *pennies* (int), matching the existing fee columns.

-- Per-job split, written at accrual alongside fee_amount_pennies (migration 023).
-- Nullable like fee_amount_pennies: null until the job is first paid.
alter table jobs add column fee_net_pennies int;
alter table jobs add column fee_vat_pennies int;

-- Per-collection split, summed from the constituent jobs at batch time. Not-null
-- with a 0 default, mirroring fee_collections.total_pennies (migration 023).
alter table fee_collections add column net_pennies int not null default 0;
alter table fee_collections add column vat_pennies int not null default 0;

-- Backfill the split for fees already accrued/collected before this migration,
-- from the gross already stored. Uses the same VAT-inclusive rounding as the
-- application (net = round(gross / 1.2), vat = gross - net) so history matches
-- new rows exactly and the net + vat == gross invariant holds retroactively.
update jobs
  set fee_net_pennies = round(fee_amount_pennies / 1.2),
      fee_vat_pennies = fee_amount_pennies - round(fee_amount_pennies / 1.2)
  where fee_amount_pennies is not null;

update fee_collections
  set net_pennies = round(total_pennies / 1.2),
      vat_pennies = total_pennies - round(total_pennies / 1.2)
  where total_pennies > 0;
