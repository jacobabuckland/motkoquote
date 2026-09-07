-- REF-3: Referral month credits — discrete subscription month records with consumed state
--
-- Every fifth referral activation (5, 10, 15, ...) banks one subscription month
-- credit. These credits are stored as discrete records and consumed one at a time
-- when Stripe subscription invoices are paid.
--
-- No cap: unlike free jobs (capped at 10), referral month credits may accumulate
-- without limit. The liability is visible as a number rather than uncountable.

create table referral_credits (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors(id) on delete cascade,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Index for consumption queries (eq contractor_id, eq consumed false, limit 1)
create index referral_credits_contractor_unconsumed_idx
  on referral_credits(contractor_id, created_at)
  where consumed = false;

-- RLS: contractors see only their own credits
alter table referral_credits enable row level security;

create policy "Contractors see own credits"
  on referral_credits
  for select
  using (
    contractor_id in (
      select id from contractors where owner_user_id = auth.uid()
    )
  );

-- No insert/update/delete grants to anon or authenticated.
-- Credits are created and consumed by service-role only (via paid-job settlement
-- and Stripe subscription invoice handling).
