-- Lightweight first-party product analytics.
-- Events are append-only; user_id is nullable so pre-signup / anonymous
-- (customer) events can be recorded with no owner.

create table events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_name_created_at_idx on events (event_name, created_at);

alter table events enable row level security;

-- Authenticated users may only insert rows attributed to themselves.
-- There are deliberately no select/update/delete policies: RLS defaults to
-- deny, so clients can never read, mutate, or delete events. Anonymous
-- (null user_id) events are written server-side with the service role,
-- which bypasses RLS.
create policy "Users insert own events"
  on events for insert
  to authenticated
  with check (user_id = auth.uid());
