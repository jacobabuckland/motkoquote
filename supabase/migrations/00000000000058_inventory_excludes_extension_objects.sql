-- The object inventory must not report what CREATE EXTENSION put there.
--
-- 00000000000056 enumerated every function in `public`, and the first live run
-- of object-inventory.check.test.ts against production reported 91 of them as
-- "reached the database without passing through this repository". Ninety of
-- those are pgvector — `vector_add`, `halfvec_cmp`, `hnswhandler` and the rest
-- — and they did pass through this repository: `create extension if not exists
-- vector` is line 4 of 00000000000001_init_schema.sql. (The ninety-first,
-- `quotes_set_updated_at`, is a real omission from the manifest and is added to
-- it in the same change; it comes from 00000000000051.)
--
-- The alternative was to paste all ninety names into public-surface.json. That
-- is worse than noise. The manifest exists to be read by a human deciding
-- whether something unexpected appeared, and burying the dozen objects that
-- carry meaning under ninety vector operators makes the answer unreadable — and
-- it would churn on every pgvector upgrade, so the reviewer learns to wave the
-- diff through, which is the failure the check exists to prevent.
--
-- An extension is reviewed as a unit, at the migration that installs it. Its
-- members are covered there. What this check is for is the object that belongs
-- to no extension and no migration: `settle_fee_collection`, created by hand,
-- called by no code, live for weeks. That one has no pg_depend edge to an
-- extension and is still reported.
create or replace function check_public_object_inventory()
returns table(object_kind text, object_name text)
language sql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select 'table'::text, c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not exists (
      select 1
      from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_class'::regclass
        and d.objid = c.oid
        and d.deptype = 'e'
    )
  union all
  select 'function'::text, p.proname::text
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and not exists (
      select 1
      from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_proc'::regclass
        and d.objid = p.oid
        and d.deptype = 'e'
    )
  group by p.proname
  order by 1, 2;
$$;

-- `create or replace function` keeps the privileges the function already had,
-- so these are a restatement rather than a change. They are restated anyway:
-- the revoke is the reason this function is not itself part of the attack
-- surface it describes, and a reader of this file should not have to open
-- 00000000000056 to find out whether it still holds.
revoke execute on function check_public_object_inventory() from public;
revoke execute on function check_public_object_inventory() from anon, authenticated;

-- Down migration (for rollback):
-- Re-apply the body from 00000000000056_public_surface_audit.sql, which is the
-- same query without the two pg_depend exclusions.
