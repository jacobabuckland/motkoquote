-- CONN-5: Add pay_by_bank_payments capability column
-- This column tracks whether the connected account's pay_by_bank_payments
-- capability is active, which is required for Pay by Bank payments when
-- using on_behalf_of (CONN-4). It is independent of stripe_payouts_enabled
-- (the transfers capability).

alter table contractors
  add column stripe_pay_by_bank_enabled boolean not null default false;
