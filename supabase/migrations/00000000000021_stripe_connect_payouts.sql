-- Stripe Connect Express onboarding for tradesperson payouts. We never hold
-- bank details ourselves — Stripe's hosted onboarding collects and stores them.
-- Here we only persist the connected account id and the status flags Stripe
-- reports back via account.updated webhooks.
alter table contractors add column stripe_account_id text;
alter table contractors add column stripe_charges_enabled boolean not null default false;
alter table contractors add column stripe_payouts_enabled boolean not null default false;
-- True when Stripe still needs more information (requirements.currently_due is
-- non-empty) — drives the "Finish payout setup" banner.
alter table contractors add column stripe_requirements_due boolean not null default false;

-- The webhook maps account.updated events back to a contractor by account id.
create unique index contractors_stripe_account_id_key
  on contractors (stripe_account_id)
  where stripe_account_id is not null;
