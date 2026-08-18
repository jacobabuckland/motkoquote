-- Enable row level security on cron_locks
-- Issue #221: prevent anon role from inserting/selecting lock rows

alter table cron_locks enable row level security;

-- Helper function to check RLS status on all public tables
-- Used by src/checks/rls.check.test.ts
create or replace function check_public_tables_rls()
returns table(table_name text, rls_enabled boolean)
language sql
security definer
as $$
  select
    c.relname::text as table_name,
    c.relrowsecurity as rls_enabled
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
  order by c.relname;
$$;

-- Down migration (for rollback):
-- drop function if exists check_public_tables_rls();
-- alter table cron_locks disable row level security;
