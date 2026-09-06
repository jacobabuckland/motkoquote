-- REFUND-2: Add refund tracking columns to payment_stages.
--
-- These mirror the refund-tracking columns jobs already has —
-- payment_provider_ref, settlement_state, and total_refunded_pennies — so each
-- stage can track its own Stripe settlement and refund state independently.

alter table payment_stages
  add column payment_provider_ref text,
  add column settlement_state text,
  add column total_refunded_pennies integer;

comment on column payment_stages.payment_provider_ref is
  'Stripe PaymentIntent id (pi_...) or TrueLayer payment id (tl_...) for this stage. Null when marked paid manually.';

comment on column payment_stages.settlement_state is
  'Refund state: null when settled normally, "refunded" when fully returned, "partially_refunded" when partially returned. Never "settled" — that value is never written.';

comment on column payment_stages.total_refunded_pennies is
  'Total refunded for this stage, in pennies. Null until the first refund.';
