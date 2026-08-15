-- Resolves the SECOND half of the events-table drift that migration 34 only
-- half-converged.
--
-- Background: migration 19 (analytics_events) is recorded as APPLIED in the
-- remote ledger but ghost-applied — its DDL never matched the repo. The live
-- production `events` table carries a column `event` (text, NOT NULL, no
-- default) that NO migration in this repo ever created. Migration 34 diagnosed
-- the missing `event_name` and added it, converging one half of the drift, but
-- it never touched the stray `event` column. Because `event` is NOT NULL with
-- no default and track() (src/lib/analytics.ts) never writes it, EVERY insert
-- into `events` fails a not-null violation — the table has sat at zero rows
-- since analytics shipped, swallowing quote_created, voice_session_completed,
-- and every error event.
--
-- Confirmed against prod on 2026-08-13 (service-role REST insert omitting
-- `event` returned: 23502 "null value in column \"event\" of relation
-- \"events\" violates not-null constraint"). The ledger alone is not proof —
-- this was verified by probing the live column, per CLAUDE.md.
--
-- WHY THIS FILE IS VERSION 37, NOT 36:
-- The remote migration ledger already reports a version `00000000000036` as
-- applied, yet NO migration 36 exists anywhere in this repo (origin/main stops
-- at 35). That is a phantom ledger entry — another instance of the same drift.
-- Had this fix been numbered 36, `supabase db push` would have matched the
-- phantom remote 36 and SKIPPED the file, and the DDL would never have landed
-- (the exact ghost-apply trap that left the table broken in the first place).
-- Numbering it 37 — a version the remote ledger does not carry — guarantees the
-- statement actually runs.
--
-- Resolution: make `event` nullable rather than dropping it.
--   * CLAUDE.md forbids destructive DDL, and a dropped column is unrecoverable
--     if some unknown consumer of the drifted table still reads it. Relaxing
--     NOT NULL is the minimal, reversible change that unblocks every write while
--     preserving the column and any data in it.
--   * We deliberately do NOT add a default or backfill: historical events are
--     already gone (the table has never accepted a row), and the live code path
--     writes `event_name`, not `event`.
--
-- Idempotent and safe on fresh/local databases: the `event` column only exists
-- on the drifted production table, so the guard is a no-op everywhere else
-- (repo migration 19 creates `event_name`, never `event`).

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and column_name = 'event'
  ) then
    alter table events alter column event drop not null;
  end if;
end $$;
