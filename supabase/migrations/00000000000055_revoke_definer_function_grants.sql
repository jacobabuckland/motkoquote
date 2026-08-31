-- Close the two exposures migration 56's checks were written to find.
--
-- Both are SECURITY DEFINER functions in the public schema holding EXECUTE for
-- `anon` and `authenticated`. The publishable key ships in the browser bundle,
-- so those roles mean "anyone", and SECURITY DEFINER means RLS does not apply
-- to anything the function touches.
--
-- Decision recorded in areas/motko.md, 31 Aug 2026. Revoke rather than drop:
-- reversible in one statement, changes nothing for the service role, and it
-- closes the hole completely. Dropping settle_fee_collection is the tidier end
-- state and can follow once its callers are certain — its full definition is
-- preserved on the Notion bug card either way.

-- 1. settle_fee_collection
--
-- Given a fee_collections id, it marks the collection paid with a CALLER-SUPPLIED
-- payment reference, flips every linked job from accrued to collected, and
-- clears the contractor's billing hold. Reachable unauthenticated at
-- /rest/v1/rpc/settle_fee_collection, with RLS bypassed on all three writes.
--
-- Not exploitable while fee_collections is empty, which it was when this was
-- found; it becomes live the moment FEE billing does. It appears in no earlier
-- migration and is called by no application code or edge function — it reached
-- production outside the migration flow, which is the other thing migration 56
-- now checks for.
revoke execute on function public.settle_fee_collection(uuid, text, timestamptz)
  from anon, authenticated;
revoke execute on function public.settle_fee_collection(uuid, text, timestamptz)
  from public;

-- 2. check_public_tables_rls
--
-- The RLS self-check's catalog reader, from migration 39. Lower severity: it
-- discloses WHICH public tables lack RLS rather than offering a way in. Still
-- not something to serve to the internet — it is a map of where to look.
--
-- Its only caller is src/checks/rls.check.test.ts, which uses the service-role
-- key and is unaffected. Verified by grep across the repository: no `.rpc(...)`
-- call to it outside that check.
revoke execute on function public.check_public_tables_rls() from anon, authenticated;
revoke execute on function public.check_public_tables_rls() from public;

-- 3. Pin the search_path on both.
--
-- A SECURITY DEFINER function with a mutable search_path is a privilege
-- escalation vector in its own right: it runs as its owner, so a caller able to
-- influence schema resolution can have it resolve an unqualified name to an
-- object of their choosing. Both functions reference only public tables and
-- catalogs, so pinning changes no behaviour.
--
-- Supabase's own advisor flags both (lint 0011, function_search_path_mutable).
alter function public.settle_fee_collection(uuid, text, timestamptz)
  set search_path = public, pg_temp;
alter function public.check_public_tables_rls()
  set search_path = public, pg_catalog, pg_temp;

-- Down migration (for rollback):
-- grant execute on function public.settle_fee_collection(uuid, text, timestamptz) to anon, authenticated;
-- grant execute on function public.check_public_tables_rls() to anon, authenticated;
-- alter function public.settle_fee_collection(uuid, text, timestamptz) reset search_path;
-- alter function public.check_public_tables_rls() reset search_path;
