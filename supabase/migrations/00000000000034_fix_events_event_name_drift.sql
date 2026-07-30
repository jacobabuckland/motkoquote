-- Corrective migration for a schema/ledger drift on the events table.
--
-- Migration 00000000000019_analytics_events is recorded as APPLIED in the
-- remote migration ledger, but its DDL never actually landed on production: the
-- live events table exists with only (id, user_id, properties, created_at) and
-- has NO event_name column. Because `supabase db push` only runs migrations the
-- ledger considers pending, re-running 19 is not an option — this new migration
-- re-asserts 19's intended shape idempotently so the schema converges whether or
-- not 19 ever ran.
--
-- Impact this fixes: track()/logError() (src/lib/analytics.ts) insert
-- event_name on every write, so every product-analytics and error insert has
-- failed since the analytics feature shipped (2026-07-17), leaving the events
-- table at zero rows. The empty table is why the NOT NULL below is safe with no
-- backfill.

alter table events add column if not exists event_name text;

-- The drifted table is empty, so there is nothing to backfill; guard the
-- constraint anyway in case a partial apply ever left a NULL row behind.
update events set event_name = 'unknown' where event_name is null;
alter table events alter column event_name set not null;

create index if not exists events_name_created_at_idx on events (event_name, created_at);

-- Re-assert 19's RLS intent idempotently. If the ghost-applied migration also
-- skipped the policy, authenticated own-row inserts would still be denied once
-- the column exists; drop-if-exists + create converges it either way. (Anonymous
-- events are written server-side with the service role, which bypasses RLS.)
alter table events enable row level security;

drop policy if exists "Users insert own events" on events;
create policy "Users insert own events"
  on events for insert
  to authenticated
  with check (user_id = auth.uid());
