-- FEE-10: a distinct settlement state for a payment that was reversed.
--
-- RENUMBERED 57 -> 59 on 2026-09-01, and the DDL below is unchanged.
--
-- This was authored as 57 on #499 and merged. Concurrently, the account-erasure
-- branch had numbered its own two migrations 57 and 58 against main as it stood
-- before #499 landed, and those two were pushed to production first — so the
-- ledger records 57=account_erasure and 58=half_day_rate, and `supabase db push`
-- would have treated version 57 as already applied and skipped this file for
-- good. The column would never have appeared, silently, which is exactly the
-- failure this file's own header warns about: #387 shipped on "the push was run"
-- rather than on reading the column back.
--
-- Renumbering this one rather than the two already in the ledger is the option
-- that needs no `supabase migration repair`: the applied versions keep their
-- numbers, this takes the next free one, and files and ledger agree afterwards.
-- Nothing here had run, so nothing becomes inconsistent by moving it.
--
-- MIGRATION ONLY. No code reads this column yet, deliberately: "schema must
-- precede code" (CLAUDE.md), and ci.yml refuses a PR pairing a new migration
-- with src/ changes while schema-drift-probe has no credentials. Land this,
-- apply it, read the column back off production, THEN the code that writes it.
-- #387 shipped on "the push was run" rather than on reading the column back,
-- and took every job page and every customer quote link down.
--
-- WHY A NEW COLUMN RATHER THAN A fee_status VALUE
--
-- jobs.fee_status (migration 23) answers "what happened to the FEE":
-- not_applicable, accrued, collected, waived_refund. A reversal is a fact about
-- the PAYMENT, and FEE-10's whole rule is that the fee is unchanged by one —
-- the service fee is non-refundable and the stored amounts stay exactly as
-- settlement wrote them. Encoding the reversal in fee_status would say the
-- opposite: it would change the fee's recorded state on an event that by
-- definition does not change the fee.
--
-- The two states are kept apart for the reason FEE-10's card gives. They look
-- identical in the fee columns — both end with nothing retained — and mean
-- opposite things:
--
--   reversed_after_settlement   a fee was due, was charged, and is KEPT
--   reversed_before_settlement  no fee was ever due; there is nothing to keep
--
-- Collapsing them would make "motko kept £43 on a job that was refunded" and
-- "motko charged nothing because the payment never settled" indistinguishable
-- in the ledger, which is precisely the question a contractor disputing a
-- deduction would ask.
--
-- Nullable, with no default. Null means "not reversed", which is every row
-- today and every ordinary settlement hereafter. A default would assert a
-- reversal state for rows that have none.
--
-- ROLLBACK: alter table jobs drop column settlement_state;
--           drop index if exists jobs_settlement_state_idx;

alter table jobs
  add column settlement_state text
    check (settlement_state in ('reversed_after_settlement', 'reversed_before_settlement'));

comment on column jobs.settlement_state is
  'FEE-10. Null for an ordinary settlement. Set when the payment behind this job is reversed: reversed_after_settlement (a fee was charged and is kept) or reversed_before_settlement (no fee was ever due). Never alters the fee_* columns — the service fee is non-refundable.';

-- Partial: reversals are rare and every query over this column asks for the
-- non-null rows. A full index would be almost entirely null entries.
create index if not exists jobs_settlement_state_idx
  on jobs (settlement_state)
  where settlement_state is not null;
