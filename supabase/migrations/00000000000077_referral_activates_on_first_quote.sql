-- REF-4: the referral reward fires on the referee's first QUOTE, not their
-- first paid job.
--
-- A tighter loop, and a deliberate trade. Under the paid-job trigger a reward
-- cost the referee finding a customer, sending a quote, having it accepted and
-- getting paid through motko — weeks, and mostly outside anybody's control. The
-- referrer had no way to tell whether their referral was working. Sending one
-- quote is the first act that shows the trade actually adopted motko, and it
-- happens on day one.
--
-- WHY A NEW COLUMN rather than reusing referee_first_paid_job_id: that column
-- means what its name says, and rows already carry it. Redefining it in place
-- would silently change the meaning of existing data and leave no way to tell
-- a paid-job activation from a quote activation. Both columns are nullable and
-- either may be set; which one is populated records WHICH trigger fired.
--
-- The paid-job path is left in place as a safety net. It looks up a referral
-- still `pending`, so once a quote has activated one there is nothing for it to
-- find and it cannot double-grant.
--
-- ROLLBACK:
--   alter table referrals drop column if exists referee_first_quote_job_id;

alter table referrals
  add column referee_first_quote_job_id uuid references jobs (id) on delete set null;

comment on column referrals.referee_first_quote_job_id is
  'The job whose first sent quote activated this referral (REF-4). Mutually exclusive in practice with referee_first_paid_job_id, which records the older paid-job trigger.';
