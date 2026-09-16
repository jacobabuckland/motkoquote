-- PASS-13 SERIOUS 3: the Activity panel now implies an acceptance that never
-- happened.
--
-- Migration 82 stopped a re-issue ERASING the acceptance. It did not stop the
-- surviving entry becoming misleading, which the reviewer found is worse:
--
--   Quote accepted   18:02
--   Quote viewed     18:01
--   Quote sent       18:00
--
-- on a job whose quote now reads £840.00. The customer accepted £600.00. Read
-- months later, in a dispute, that log says they agreed to £840. Pass 12's
-- version of this bug destroyed the evidence; this version leaves evidence
-- pointing the wrong way.
--
-- Two columns, because the panel is a projection of current row state and two
-- different facts are missing from it.
--
-- 1. quotes.accepted_total
--
-- WHAT the customer accepted, recorded beside WHEN they accepted it
-- (`accepted_first_at`, migration 82). Never cleared, for the same reason: a
-- re-issue overwrites `total`, and the figure that was agreed must survive the
-- figure that replaced it. This is what lets the entry read "Quote accepted —
-- £600.00" on a quote that now says £840.00, which is the whole of the fix.
--
-- 2. quotes.reissued_at
--
-- WHEN the quote was last re-issued. `announceReissue` already carries the
-- comment "the history of the job is not overwritten with it — 'Quote
-- accepted' then 'Quote re-issued' is what the Activity timeline should read",
-- and then sends the event to `track()`: an analytics sink the timeline cannot
-- see. AGENTS.md names that outright — a signal that must change behaviour
-- cannot terminate in telemetry. The timeline needs a timestamp on the row, and
-- there has never been one.
--
-- THE LAST re-issue, not every one. A column holds one value, and a quote
-- re-issued three times keeps only the most recent date. That is a deliberate
-- limit, not an oversight: the panel's job here is to stop the log asserting
-- something false, and one dated "Quote re-issued" entry does that. A full
-- event history is an events table, which remains the better long-run answer
-- and remains not this item — for the same reasons recorded on migration 82.
--
-- NO BACKFILL OF INVENTED VALUES, on either column.
--
-- `accepted_total` is backfilled ONLY where `accepted_at` is still set, because
-- there `total` demonstrably is the accepted figure: nothing has re-issued it.
-- A quote already re-issued has lost the number it was accepted at — `total`
-- now holds the NEW figure — so writing `total` there would assert that the
-- customer accepted the current price, which is precisely the false claim this
-- migration exists to stop. Those stay null and read as "not recorded".
--
-- `reissued_at` is not backfilled at all. Quotes that were re-issued before
-- today are identifiable (`accepted_first_at` set, `accepted_at` null) but the
-- moment it happened was never stored, and a plausible substitute would put a
-- date on a customer document's history that nobody can stand behind.

alter table quotes add column if not exists accepted_total numeric;

alter table quotes add column if not exists reissued_at timestamptz;

comment on column quotes.accepted_total is
  'The total the customer accepted, recorded beside accepted_first_at and never cleared. `total` is overwritten by a re-issue; this is not, so the Activity panel can say what was actually agreed. Null for quotes never accepted, and for acceptances that predate migration 84.';

comment on column quotes.reissued_at is
  'When this quote was last re-issued after acceptance. Feeds the job page Activity panel. Holds the most recent re-issue only — a full event history is an events table, deliberately not this. Null for quotes never re-issued.';

-- Safe only where the acceptance is still CURRENT. There `total` has not been
-- replaced, so it is the accepted figure rather than a later one wearing its
-- clothes. Quotes already re-issued stay null: the number they were accepted at
-- is gone, and inventing it is the defect.
update quotes
  set accepted_total = total
  where accepted_at is not null
    and accepted_total is null;
