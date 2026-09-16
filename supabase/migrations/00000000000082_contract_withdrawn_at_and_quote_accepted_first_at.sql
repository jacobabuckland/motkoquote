-- PASS-12 SERIOUS 3 and 4: the Activity panel is a projection of current row
-- state, so an event that leaves no surviving timestamp never happened.
--
-- Two columns, for two events that are real and currently invisible.
--
-- 1. contracts.withdrawn_at
--
-- CONTRACT-1 (#786) shipped withdrawal with no timestamp, on a decision of mine
-- that the dashboard's "Signed & declined contracts" list did not need one.
-- That was right about the list and wrong about the Activity panel, which I did
-- not consider. `buildTimeline` even carries a comment saying a withdrawn
-- contract appears there; nothing records when, so it cannot.
--
-- 2. quotes.accepted_first_at
--
-- Re-issuing an accepted quote clears `accepted_at` — correctly, or the job
-- reads as accepted while awaiting a second acceptance. The timeline reads the
-- same column, so the acceptance does not merely stop being current, it stops
-- ever having happened: the reviewer edited an accepted quote and watched
-- "Quote accepted" vanish from the log. If a dispute follows, the audit trail
-- now says the customer never accepted anything.
--
-- A separate column rather than an events table. An events table is the better
-- long-run answer and is not this item: it is a larger change, it needs every
-- writer moved onto it, and it would hold up two one-line fixes behind a
-- redesign. This records the FIRST acceptance and is never cleared, so the
-- history survives however many times a quote is re-issued.
--
-- Both nullable with no default and no backfill of invented times. A row that
-- predates this migration has no recorded moment for these events, and writing
-- a plausible one — created_at, say — would put a date on a customer document's
-- history that nobody can stand behind. Absent reads as "not recorded", which
-- is true.

alter table contracts add column if not exists withdrawn_at timestamptz;

alter table quotes add column if not exists accepted_first_at timestamptz;

comment on column contracts.withdrawn_at is
  'When the contractor withdrew this sent, unsigned contract. Null unless status = ''withdrawn''. Feeds the job page Activity panel.';

comment on column quotes.accepted_first_at is
  'When this quote was FIRST accepted by the customer. Never cleared — accepted_at is cleared on re-issue, and this is what keeps the acceptance in the Activity panel. Null for quotes never accepted, and for acceptances that predate migration 82.';

-- Existing acceptances that are still current can be carried across exactly,
-- because accepted_at is the real recorded time and is not invented. Quotes
-- already re-issued before this migration have lost their original acceptance
-- and stay null: there is nothing truthful to write.
update quotes
  set accepted_first_at = accepted_at
  where accepted_at is not null
    and accepted_first_at is null;
