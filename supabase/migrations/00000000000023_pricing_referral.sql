-- Pricing & referral model (open-banking / pay-by-bank).
--
-- motko is free to quote; it only earns when a job is *paid*. The first 5 paid
-- jobs per trade are free; after that a flat fee (£2 up to £1,000, £4 above,
-- hard cap) accrues per paid job and is collected separately via a mandate.
-- Every referred trade who lands their first paid job unlocks +5 free jobs.
--
-- The append-only `credit_events` ledger is the source of truth for the free
-- allowance; `contractors.free_jobs_remaining` is a cache that must always
-- equal sum(delta) for that contractor (reconciled nightly).
--
-- The "trade" in the spec is a `contractors` row (owner_user_id -> auth.users).
-- All money columns introduced here are in *pennies* (int). Note the existing
-- `invoices.amount` / `quotes.total` are numeric pounds — convert at the
-- boundary, never mix the two conventions.

-- ---------------------------------------------------------------------------
-- Referral code generation (unambiguous 6-char alphabet, no O/0/I/1).
-- ---------------------------------------------------------------------------
create or replace function gen_referral_code() returns text
  language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
           1 + floor(random() * 32)::int, 1),
    '')
  from generate_series(1, 6);
$$;

-- ---------------------------------------------------------------------------
-- referrals — one row per referred trade. `referee_contractor_id` is unique:
-- a trade can only ever be referred (and rewarded) once. Reward fires on the
-- referee's first paid job (status pending -> activated -> rewarded).
-- ---------------------------------------------------------------------------
create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_contractor_id uuid not null references contractors (id) on delete cascade,
  referee_contractor_id uuid references contractors (id) on delete set null,
  code_used text not null,
  status text not null default 'pending'
    check (status in ('pending', 'activated', 'rewarded')),
  referee_first_paid_job_id uuid references jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  -- A trade is referred at most once. Guards ghost-farming and double rewards.
  unique (referee_contractor_id),
  -- No self-referral (belt-and-braces; app also blocks on shared email/phone/bank).
  check (referrer_contractor_id is distinct from referee_contractor_id)
);
create index referrals_referrer_idx on referrals (referrer_contractor_id);

-- ---------------------------------------------------------------------------
-- credit_events — append-only free-job ledger, the source of truth.
-- delta: +5 signup, +5 per activated referral, -1 per paid job that consumes a
-- free credit, +1 on refund of a consumed job. sum(delta) == free_jobs_remaining.
-- ---------------------------------------------------------------------------
create table credit_events (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  delta int not null,
  reason text not null
    check (reason in ('signup_grant', 'referral_unlock', 'job_consumed',
                      'refund_restore', 'admin_adjust')),
  related_job_id uuid references jobs (id) on delete set null,
  related_referral_id uuid references referrals (id) on delete set null,
  created_at timestamptz not null default now()
);
create index credit_events_contractor_idx on credit_events (contractor_id);
-- A paid job consumes a free credit at most once — the webhook is idempotent on
-- this partial unique index (job_consumed rows are unique per job).
create unique index credit_events_job_consumed_key
  on credit_events (related_job_id)
  where reason = 'job_consumed';

-- ---------------------------------------------------------------------------
-- fee_collections — batched billing runs. Accrued fees for a period are pulled
-- in one mandate collection so the trade sees a single "motko — £18 (9 jobs)".
-- ---------------------------------------------------------------------------
create table fee_collections (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  job_ids uuid[] not null default '{}',
  total_pennies int not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'collected', 'failed')),
  provider_collection_ref text,
  collected_at timestamptz,
  created_at timestamptz not null default now()
);
create index fee_collections_contractor_status_idx
  on fee_collections (contractor_id, status);

-- ---------------------------------------------------------------------------
-- contractors — referral code, cached free-job balance, fee-collection mandate.
-- ---------------------------------------------------------------------------
alter table contractors add column referral_code text;
alter table contractors add column free_jobs_remaining int not null default 5;
-- VRP / Direct Debit mandate authorising motko to collect accrued fees.
alter table contractors add column fee_mandate_id text;
alter table contractors add column fee_collection_status text not null default 'active'
  check (fee_collection_status in ('active', 'past_due', 'paused'));

-- Backfill a unique referral code for every existing contractor. Retry on the
-- (improbable) collision against the unique index created just below.
create unique index contractors_referral_code_key
  on contractors (referral_code)
  where referral_code is not null;

do $$
declare
  r record;
  new_code text;
begin
  for r in select id from contractors where referral_code is null loop
    loop
      new_code := gen_referral_code();
      begin
        update contractors set referral_code = new_code where id = r.id;
        exit;
      exception when unique_violation then
        -- collision — generate another
      end;
    end loop;
  end loop;
end $$;

-- Every existing contractor keeps the invariant sum(delta) == free_jobs_remaining
-- from day one: the not-null-default already set the cache to 5, so grant a
-- matching signup ledger row. New signups do the same in application code.
insert into credit_events (contractor_id, delta, reason)
select id, 5, 'signup_grant' from contractors;

-- ---------------------------------------------------------------------------
-- jobs — per-job fee accrual. The band is decided on the job's invoiced total
-- at first payment; the fee accrues once per job (staged payments don't
-- re-charge). paid_at is the first successful payment.
-- ---------------------------------------------------------------------------
alter table jobs add column job_value_pennies int;
alter table jobs add column fee_amount_pennies int;
alter table jobs add column fee_waived_reason text
  check (fee_waived_reason in ('free_allowance'));
alter table jobs add column fee_status text not null default 'not_applicable'
  check (fee_status in ('not_applicable', 'accrued', 'collected', 'waived_refund'));
-- The PISP (TrueLayer) payment id for the job's first payment.
alter table jobs add column payment_provider_ref text;
alter table jobs add column paid_at timestamptz;
create index jobs_payment_provider_ref_idx
  on jobs (payment_provider_ref)
  where payment_provider_ref is not null;

-- ---------------------------------------------------------------------------
-- RLS: a trade reads only its own rows. All writes go through the server-side
-- service-role client (which bypasses RLS) — there are deliberately no
-- insert/update/delete policies for authenticated users.
-- ---------------------------------------------------------------------------
alter table referrals enable row level security;
alter table credit_events enable row level security;
alter table fee_collections enable row level security;

-- Both parties to a referral can see it (referrer tracks unlocks; referee sees
-- who referred them).
create policy "Referral parties read" on referrals for select
  using (
    referrer_contractor_id in (select id from contractors where owner_user_id = auth.uid())
    or referee_contractor_id in (select id from contractors where owner_user_id = auth.uid())
  );

create policy "Owner read" on credit_events for select
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

create policy "Owner read" on fee_collections for select
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
