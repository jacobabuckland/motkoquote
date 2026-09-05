-- SUB-1: Stripe Billing subscription at £9.99/month, billed once free jobs used
--
-- Subscription state projected from Stripe webhook events. Never a local boolean
-- as source of truth — this table is rebuilt from provider state, with idempotency
-- and out-of-order delivery handling baked in.

create table subscription_projection (
  contractor_id uuid primary key references contractors (id) on delete cascade,
  stripe_subscription_id text not null,
  stripe_customer_id text not null,
  subscription_status text not null,
  trial_end bigint,
  last_event_id text not null,
  last_event_created bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subscription_projection_stripe_subscription_id_key
  on subscription_projection (stripe_subscription_id);

create index subscription_projection_stripe_customer_id_idx
  on subscription_projection (stripe_customer_id);

-- Event ID index for idempotency checks: has this exact event been processed?
create index subscription_projection_last_event_id_idx
  on subscription_projection (last_event_id);
