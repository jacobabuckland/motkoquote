-- A deposit is agreed when the price is agreed, not typed into a field later.
--
-- WHY. Deposits exist today only as `contracts.deposit_pct`, a number entered
-- on the contract after the customer has already accepted. Seven production
-- contracts carry it and two are at 1% on £7-8k jobs — £72 and £81, figures
-- typed to clear a required field rather than to ask for a deposit. The quote
-- the customer actually reads, at /q/[id], never mentions a deposit at all, so
-- every one of those seven was agreed after acceptance or not at all. The
-- voice-captured `deposit_amount` is set on 0 of 25 SoWs and read by nothing.
--
-- The money that goes missing is the money agreed verbally and taken in cash,
-- because the app offered nowhere to put it.
--
-- TWO COLUMNS, AND THEY DO DIFFERENT JOBS.
--
--   quotes.deposit_pennies — what was agreed, recorded on the quote the
--     customer saw. Read at signature to raise the deposit invoice, in place
--     of deriving it from a percentage on the contract.
--
--   payment_stages.work_completed_at — that the WORK for one stage is done.
--     Distinct from `settled_at`, which means that stage's money has arrived.
--     A stage needs both, in that order, and conflating them is how a job with
--     a settled deposit came to show every milestone ticked (#739).
--
-- NULLABLE, AND NULL MEANS NOT AGREED / NOT DONE — never zero.
--
-- A null `deposit_pennies` is a quote with no deposit, which is the normal
-- case and must keep behaving exactly as it does now. A ZERO is different: it
-- is a deposit explicitly agreed at nothing, and the check below allows it so
-- that "we agreed no deposit" can be recorded as an answer rather than as
-- silence. The same distinction migration 80 draws between a recorded £0.00 of
-- VAT and a null.
--
-- NOT BACKFILLED. The seven contracts carrying `deposit_pct` keep it, and the
-- signature path keeps reading it as a fallback. Copying those percentages
-- onto their quotes would assert they were agreed at quote time, which is the
-- one thing we know is untrue of all seven.
--
-- `contracts.deposit_pct` is NOT dropped and NOT deprecated in this migration.
-- Nothing is removed here; the code that supersedes it lands separately, and
-- this file must be safe to apply to production before that code exists.
--
-- ROLLBACK: alter table quotes drop column deposit_pennies;
--           alter table payment_stages drop column work_completed_at;

alter table quotes
  add column deposit_pennies integer;

-- Zero is allowed and means "agreed at nothing". Negative is not a deposit.
alter table quotes
  add constraint quotes_deposit_pennies_non_negative
  check (deposit_pennies is null or deposit_pennies >= 0);

comment on column quotes.deposit_pennies is
  'The deposit agreed with the customer at quote time, in pennies. Null means no deposit was agreed; 0 means one was agreed at nothing. Read at contract signature to raise the deposit invoice, superseding contracts.deposit_pct for quotes that carry it.';

alter table payment_stages
  add column work_completed_at timestamptz;

comment on column payment_stages.work_completed_at is
  'When the work for this stage was marked complete, which is what triggers its invoice. Distinct from settled_at, which is when that invoice was paid. A stage is worked, then invoiced, then settled.';

-- The trigger for stage 2 onwards is a per-stage completion, and the update
-- that stamps it is the race guard ("... where work_completed_at is null"),
-- so it is worth an index: it is read on every job page and written once per
-- stage.
create index idx_payment_stages_work_completed_at
  on payment_stages(job_id, work_completed_at);
