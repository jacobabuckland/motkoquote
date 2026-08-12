-- Rate limiting table to track request counts per client per route
create table if not exists public.rate_limits (
  client_key text not null,
  route_key text not null,
  request_count integer not null default 1,
  window_start timestamptz not null default now(),
  primary key (client_key, route_key)
);

-- Index for efficient lookups and cleanup
create index if not exists rate_limits_window_start_idx on public.rate_limits (window_start);

-- Enable row-level security (though these are managed by server-side code only)
alter table public.rate_limits enable row level security;

-- No public access — only service role can read/write
create policy "Service role only" on public.rate_limits
  for all
  using (false);
