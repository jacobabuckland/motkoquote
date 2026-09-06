-- SUB-1: Stripe Billing subscription projection table
--
-- Stores subscription state derived from Stripe webhooks. Never a local boolean:
-- this is the single source of truth for subscription status, projected from
-- Stripe events rather than stored independently.

create table subscription_projection (
  contractor_id uuid primary key references contractors(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  subscription_status text not null,
  trial_end timestamptz,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  last_event_id text not null,
  created_at timestamptz not null default now()
);

alter table subscription_projection enable row level security;

-- Owner can SELECT their own subscription state
create policy "Owners can view their subscription"
  on subscription_projection
  for select
  using (
    contractor_id in (
      select id from contractors where owner_user_id = auth.uid()
    )
  );

-- Writes are service-role only (webhooks and server actions)
