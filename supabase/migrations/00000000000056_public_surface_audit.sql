-- NUMBERED 56, NOT 54. It was 54 until FEE-7 (#487, factory/475) turned out to
-- be claiming the same version — two branches, two different migrations, one
-- number. Whichever merged second would have collided on a version the database
-- orders and deduplicates by. This one moved because it is tooling and entirely
-- under this branch's control; FEE-7 carries a frozen spec and acceptance tests.
--
-- It therefore sorts AFTER migration 55, which revokes grants on functions that
-- already existed. There is no dependency between them: 55 touches
-- settle_fee_collection and check_public_tables_rls, both long since created;
-- this file only adds new readers.
--
-- Two catalog readers for the live-checks lane, in the same shape and for the
-- same reason as check_public_tables_rls() in migration 39: the Supabase JS
-- client cannot run raw SQL, so a check that needs pg_catalog needs an RPC.
--
-- WHY THESE EXIST.
--
-- On 31 Aug, public.settle_fee_collection(uuid, text, timestamptz) was found on
-- production: SECURITY DEFINER, owned by postgres, EXECUTE held by `anon`. It
-- marks fee collections paid with a caller-supplied payment reference, flips the
-- linked jobs to collected, and clears the contractor's billing hold — all with
-- RLS bypassed, reachable unauthenticated at /rest/v1/rpc/settle_fee_collection.
--
-- It had been live for weeks. Every gate was green. It appears in no migration
-- and no application code, and nothing in the factory was looking, because every
-- check this repository runs validates the tree against itself. Only
-- rls-check.yml looks outward, and it checked tables, not functions.
--
-- It was found because a human happened to attach a database MCP and a session
-- happened to look. That is not a process, and these two functions are what
-- replaces it.
--
--   check_public_function_privileges()  who can execute what, and does it
--                                       bypass RLS
--   check_public_object_inventory()     what exists at all, so an object that
--                                       reaches production without passing
--                                       through this repository is visible
--
-- Both are SECURITY DEFINER because reading pg_catalog's privilege columns for
-- roles other than the caller requires it. Both therefore have EXECUTE revoked
-- from anon, authenticated and PUBLIC at the bottom of this file — a catalog
-- reader that anyone can call is an inventory of your attack surface served over
-- HTTP, and one that failed its own check would be a poor advertisement.

-- Every function in the public schema, with the two facts that matter:
-- whether it bypasses RLS, and who can call it.
--
-- `has_function_privilege` rather than parsing proacl, deliberately: a NULL acl
-- means "default privileges", and Postgres grants EXECUTE to PUBLIC on function
-- creation by default. Reading the acl literally therefore reports the most
-- dangerous case — nobody has thought about permissions — as no grant at all.
create or replace function check_public_function_privileges()
returns table(
  function_name text,
  identity_arguments text,
  security_definer boolean,
  anon_execute boolean,
  authenticated_execute boolean,
  public_execute boolean
)
language sql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select
    p.proname::text,
    pg_get_function_identity_arguments(p.oid)::text,
    p.prosecdef,
    has_function_privilege('anon', p.oid, 'EXECUTE'),
    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    has_function_privilege('public', p.oid, 'EXECUTE')
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    -- Aggregates and window functions are not callable over PostgREST and have
    -- no meaningful EXECUTE surface here.
    and p.prokind = 'f'
  order by p.proname, pg_get_function_identity_arguments(p.oid);
$$;

-- Everything that exists in the public schema, as (kind, name) pairs.
--
-- Names rather than full signatures for functions: the manifest this feeds is
-- committed to the repository and reviewed by a human, and a name is what a
-- reviewer can actually check. An added overload of an existing name is the
-- known blind spot of that choice, and is covered by the privilege check above,
-- which enumerates every overload separately.
create or replace function check_public_object_inventory()
returns table(object_kind text, object_name text)
language sql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select 'table'::text, c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'function'::text, p.proname::text
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
  group by p.proname
  order by 1, 2;
$$;

-- Not callable by anyone but the service role. See the header: these describe
-- the shape of the attack surface, so they must not be part of it.
--
-- `from public` first, then the two Supabase roles by name: revoking from PUBLIC
-- does not remove a grant held directly by a role, and Supabase grants EXECUTE
-- to anon and authenticated on functions in the public schema by default.
revoke execute on function check_public_function_privileges() from public;
revoke execute on function check_public_function_privileges() from anon, authenticated;
revoke execute on function check_public_object_inventory() from public;
revoke execute on function check_public_object_inventory() from anon, authenticated;

-- Down migration (for rollback):
-- drop function if exists check_public_function_privileges();
-- drop function if exists check_public_object_inventory();
