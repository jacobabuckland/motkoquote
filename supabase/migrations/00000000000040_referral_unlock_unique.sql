-- Issue #222: Add partial unique index on credit_events for referral_unlock
--
-- Problem: When a referee's first two jobs settle concurrently, each execution
-- reads isFirstPaidJob as true and both insert a +5 credit event with
-- reason='referral_unlock', crediting the referrer 10 free jobs instead of 5.
--
-- Solution: A partial unique index on related_referral_id where reason =
-- 'referral_unlock' prevents duplicate rows at the database level, matching the
-- pattern of the existing job_consumed guard (migration 023:70-72).

-- A referral unlocks at most once — concurrent settlements of the referee's first
-- jobs are idempotent on this partial unique index (referral_unlock rows are
-- unique per referral).
create unique index credit_events_referral_unlock_key
  on credit_events (related_referral_id)
  where reason = 'referral_unlock';

-- Down migration (rollback):
-- drop index if exists credit_events_referral_unlock_key;
