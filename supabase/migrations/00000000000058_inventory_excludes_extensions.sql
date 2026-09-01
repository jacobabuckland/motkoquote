-- The object inventory must not report what an extension brought with it.
--
-- Migration 56's check_public_object_inventory() enumerates every table and
-- function in `public` and the live check compares that against the manifest
-- committed in this tree. Its first real run reported NINETY-ONE unexpected
-- objects: `create extension if not exists vector` in migration 1 installs
-- pgvector into the public schema, and every one of its operator, cast and
-- index-support functions — array_to_vector, halfvec_cmp, hnswhandler,
-- l2_distance and eighty-six more — showed up as "reached the database without
-- passing through this repository".
--
-- They did pass through it. Migration 1 created them, in the one line that
-- creates all of them at once. A check whose failure output is ninety rows of
-- known-good noise is a check people learn to scroll past, which is the failure
-- mode this whole lane exists to avoid — the manifest is meant to make ONE new
-- object visible.
--
-- Listing them in the manifest instead was the alternative and is worse: the
-- manifest would then pin pgvector's internal surface, and a routine extension
-- upgrade that adds or renames a support function would fail the check with a
-- diff nobody in this repository can act on.
--
-- So the inventory reports objects this repository is responsible for, and
-- pg_depend answers exactly that question: an object created by `CREATE
-- EXTENSION` carries a dependency of type 'e' on the extension that owns it.
-- Nothing else in the catalog does.
--
-- WHAT THIS DOES NOT CHANGE. check_public_function_privileges() still
-- enumerates every function including extension-owned ones, deliberately. Its
-- question is "who can call this and does it bypass RLS", and an extension
-- function that is SECURITY DEFINER and anon-callable is a real exposure
-- whoever created it. The two checks ask different questions and only one of
-- them is about provenance.

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

-- Same as migration 56: a catalog reader describes the shape of the attack
-- surface, so it must not be part of it. `create or replace` preserves the
-- existing grants, but stating them again costs nothing and means this file
-- leaves the function correct on its own.
revoke execute on function check_public_object_inventory() from public;
revoke execute on function check_public_object_inventory() from anon, authenticated;

-- Down migration (for rollback): re-run the definition in
-- 00000000000056_public_surface_audit.sql, which is this function without the
-- two `not exists` clauses.
