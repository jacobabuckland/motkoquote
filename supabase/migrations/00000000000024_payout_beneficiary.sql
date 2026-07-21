-- Trade payout beneficiary for open-banking (pay-by-bank).
--
-- Under Stripe Connect, Stripe's hosted onboarding collected and held the
-- trade's bank details; motko never stored them (see migration 021). Retiring
-- cards for direct-to-trade open-banking flips that: motko now initiates a
-- pay-in that settles DIRECTLY into the trade's own account as the external
-- beneficiary, so it must persist the beneficiary details to build each
-- payment. motko still never *holds* the funds — they land straight in this
-- account over Faster Payments.
--
-- Stored on `contractors` (owner_user_id -> auth.users), already RLS
-- owner-scoped. UK domestic details only (sort code + account number).
alter table contractors add column payout_account_holder_name text;
-- 6-digit sort code, digits only (no dashes).
alter table contractors add column payout_sort_code text
  check (payout_sort_code is null or payout_sort_code ~ '^[0-9]{6}$');
-- 8-digit account number, digits only.
alter table contractors add column payout_account_number text
  check (payout_account_number is null or payout_account_number ~ '^[0-9]{8}$');

-- True once all three fields are present, so the app can gate "send pay-by-bank
-- link" on a complete beneficiary without repeating the null checks.
alter table contractors add column payout_details_complete boolean
  not null default false;

-- The TrueLayer payment created for an invoice, stored so we can poll its status
-- (reconcile / 15-min expiry re-check) and avoid minting a second live payment.
-- The webhook itself maps back via echoed metadata, not this column.
alter table invoices add column truelayer_payment_id text;
create index invoices_truelayer_payment_id_idx
  on invoices (truelayer_payment_id)
  where truelayer_payment_id is not null;
