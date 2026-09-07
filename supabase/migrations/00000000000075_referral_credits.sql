-- REF-3: Banked referral credits — discrete months earned every 5th activation.
--
-- Every 5 activated referrals earn one banked month (a discrete row in this
-- table). Activations 1-4: no credit. Activation 5: 1 credit. Activation 10:
-- 2 credits total (not 2 at once). No cap on accumulation.
--
-- Credits are consumed on cancellation: a trade canceling with N unconsumed
-- credits keeps access for N months beyond the paid period. Consumption is
-- atomic — two concurrent claims against one contractor's credits must claim
-- different rows (enforced by conditional `consumed = false` in the update).
--
-- Banking does NOT replace the existing `referral_unlock` free-job grant —
-- both fire on the fifth activation.
--
-- ROLLBACK:
--   drop table if exists referral_credits;

create table referral_credits (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

create index referral_credits_contractor_id_idx
  on referral_credits (contractor_id);

create index referral_credits_consumed_idx
  on referral_credits (consumed);

alter table referral_credits enable row level security;

-- Owner-scoped read, matching the "Owner scoped via contractor" policies in
-- migration 1. `contractor_id` is a `contractors.id`, so ownership runs through
-- `contractors.owner_user_id` — never compared to auth.uid() directly.
create policy "Contractors can view their own credits"
  on referral_credits for select
  using (
    contractor_id in (
      select id from contractors where owner_user_id = auth.uid()
    )
  );

-- NO insert, update or delete policy, deliberately. Credits are system-managed:
-- banked by the service role on activation (bypasses RLS), consumed by the
-- service role on cancellation. Nothing should ever write them from a user
-- session, so there is no policy to write and RLS denies by default.

-- Defence in depth. RLS alone already closes this, since a table with RLS on
-- and no permissive policy denies every non-bypassing role. The revokes make
-- the intent explicit and survive someone later adding a broad policy: a write
-- from a browser session is refused at the grant, before any policy is
-- consulted. Precedent: migration 55 and 74.
revoke insert, update, delete, truncate on referral_credits from anon;
revoke insert, update, delete, truncate on referral_credits from authenticated;
