-- H1 — make monthly fee collection exactly-once by construction.
--
-- The monthly batch rolls every 'accrued' job into one fee_collection per trade
-- and charges the trade's mandate. Jobs only leave 'accrued' when the later
-- payment_executed webhook settles the collection, so any re-run of the cron
-- before that webhook lands re-rolled the SAME jobs into a SECOND collection and
-- charged the mandate again. There was no uniqueness stopping it.
--
-- One collection per trade per billing period is the invariant. This unique
-- index enforces it at the database, so a re-run's insert conflicts instead of
-- creating a second charge (the code upserts with ignoreDuplicates and skips on
-- conflict). Retries of a FAILED collection reuse the existing row (dunning
-- updates it in place); they never insert, so they are unaffected.
create unique index fee_collections_contractor_period_key
  on fee_collections (contractor_id, period_start);

-- Advisory run-lock for money-moving crons. A single-row-per-name table whose
-- primary key gives us atomic acquire: insert succeeds for the first runner and
-- conflicts for an overlapping one. `locked_at` lets a later run reclaim a lock
-- abandoned by a crashed run (TTL enforced in application code). Belt-and-braces
-- on top of the unique index above: overlapping cron runs no-op entirely.
create table cron_locks (
  name text primary key,
  locked_at timestamptz not null default now()
);
