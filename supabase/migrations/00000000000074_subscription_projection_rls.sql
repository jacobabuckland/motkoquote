-- SECURITY FIX: subscription_projection was created without row-level security.
--
-- Found on 6 Sep 2026 while backfilling migration 69's file onto main. Migration
-- 69 created the table and never enabled RLS, and Supabase's default grants give
-- `anon` — the publishable key that ships to every browser — the full set:
--
--   anon           DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   authenticated  DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
-- With relrowsecurity = false and zero policies, those grants are the whole
-- story: anyone holding the anon key could read every contractor's Stripe
-- subscription and customer ids, insert a row, or truncate the table.
--
-- BOUNDED, BUT NOT HARMLESS. The table is empty and SUB-1 is unmerged, so
-- nothing reads it yet and no data has been exposed. The danger is the write
-- side and it arrives with SUB-1: once `subscription_status` gates paid access,
-- an anon INSERT grants it and a TRUNCATE revokes everyone's. This must be
-- applied BEFORE SUB-1 merges.
--
-- It was the only table in `public` with RLS disabled — every other one follows
-- migration 1's owner-scoped pattern. A single miss, not a systemic gap.
--
-- ROLLBACK:
--   alter table subscription_projection disable row level security;
--   drop policy if exists "Contractors can view their own subscription"
--     on subscription_projection;
--   -- the revokes below are not restored: the grants they remove were the
--   -- Supabase default and nothing has ever relied on them.

alter table subscription_projection enable row level security;

-- Owner-scoped read, matching the "Owner scoped via contractor" policies in
-- migration 1. `contractor_id` is a `contractors.id`, so ownership runs through
-- `contractors.owner_user_id` — never compared to auth.uid() directly, which is
-- the mistake migration 70 had to correct.
create policy "Contractors can view their own subscription"
  on subscription_projection for select
  using (
    contractor_id in (
      select id from contractors where owner_user_id = auth.uid()
    )
  );

-- NO insert, update or delete policy, deliberately. This table is a projection
-- of Stripe's state, rebuilt from webhook events by the service role, which
-- bypasses RLS. Nothing should ever write it from a user session, so there is
-- no policy to write and RLS denies by default.

-- Defence in depth. RLS alone already closes this, since a table with RLS on
-- and no permissive policy denies every non-bypassing role. The revokes make
-- the intent explicit and survive someone later adding a broad policy: a write
-- from a browser session is refused at the grant, before any policy is
-- consulted. Precedent: migration 55, which revoked SECURITY DEFINER function
-- grants from anon after the settle_fee_collection exposure.
revoke insert, update, delete, truncate on subscription_projection from anon;
revoke insert, update, delete, truncate on subscription_projection from authenticated;
revoke select on subscription_projection from anon;
