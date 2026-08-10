-- Rate limiting backing store. Tracks request counts per key (IP, resource ID, etc.)
-- within sliding time windows. Rows are automatically cleaned up as windows expire.
-- No RLS: this table is only accessed via the service-role admin client.

create table rate_limits (
  id bigint primary key generated always as identity,
  key text not null,  -- e.g., "create-payment:ip:203.0.113.1" or "pdf:resource:q-123"
  timestamp bigint not null,  -- Unix timestamp in milliseconds
  created_at timestamp with time zone default now() not null
);

-- Index on key + timestamp for efficient window queries and cleanup
create index rate_limits_key_timestamp_idx on rate_limits (key, timestamp);

-- No RLS policies: accessed exclusively via service-role client
alter table rate_limits enable row level security;
