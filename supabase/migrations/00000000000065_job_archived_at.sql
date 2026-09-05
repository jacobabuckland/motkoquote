-- JOB-1: A job can only be archived at quote stage, so a cancelled or disputed
-- one hangs in the pipeline forever.
--
-- This adds job-level archiving following the same pattern as contracts:
-- a nullable timestamptz column with a partial index. Unlike the quote archive
-- (status field), this reaches every stage — a signed contract or an unpaid
-- invoice can be filed away without voiding the agreement or stopping the
-- customer's access.
--
-- Archiving hides the job from the working pipeline: it leaves the active list,
-- stops being counted in summary totals, and — critically — stops the chase
-- cron from sending automated reminders for any unpaid invoice. The customer's
-- view is unchanged: signed contracts remain viewable, unpaid invoices remain
-- payable.
alter table jobs add column archived_at timestamptz;

-- RLS: nothing to add.
--
-- The jobs table has ONE policy (00000000000001_initial_schema.sql), "Owner
-- scoped", declared `for all` and scoped by contractor -> owner_user_id =
-- auth.uid(). It is row-level and column-agnostic, so a new column is covered
-- on read and write the moment it exists: a user cannot select, archive or
-- restore another account's job, because they cannot see the row at all.
--
-- Stated, not assumed — the same rationale as the contracts migration.
--
-- The working pipeline filters `archived_at is null` in the QUERY (via
-- normalizeHistoryJob bucketing archived jobs separately), so the index keeps
-- that filter cheap as the archive grows.
create index if not exists jobs_archived_at_idx
  on jobs (archived_at)
  where archived_at is null;
