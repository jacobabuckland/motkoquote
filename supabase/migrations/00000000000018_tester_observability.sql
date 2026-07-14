-- Tester observability: funnel events, feedback valve, and client error logging.
-- Purely additive. All writes are routed server-side through the service-role
-- admin client, so RLS is enabled with no user-facing policies: normal
-- (anon / authenticated) roles get no read or write access, and only the
-- service role can insert or query. This keeps the tables tamper-resistant and
-- private to Jacob's operational queries.

create table events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  contractor_id uuid,
  event text not null,
  properties jsonb not null default '{}'::jsonb,
  path text,
  session_id text
);
create index events_event_created_idx on events (event, created_at);
create index events_user_created_idx on events (user_id, created_at);
alter table events enable row level security;

create table feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  contractor_id uuid,
  message text not null,
  path text,
  user_agent text
);
create index feedback_created_idx on feedback (created_at);
alter table feedback enable row level security;

create table client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  contractor_id uuid,
  source text not null,
  message text not null,
  stack text,
  path text,
  user_agent text,
  context jsonb not null default '{}'::jsonb
);
create index client_errors_created_idx on client_errors (created_at);
create index client_errors_message_created_idx on client_errors (message, created_at);
alter table client_errors enable row level security;
