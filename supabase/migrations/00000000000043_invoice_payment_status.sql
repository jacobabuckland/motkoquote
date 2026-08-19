-- Intermediate payment state on invoices, so the customer's return page can
-- resolve instead of dead-ending.
--
-- Stripe redirects the customer to /i/[id]/paid as soon as they come back from
-- their bank, which is before payment_intent.succeeded has settled anything.
-- The page correctly refuses to claim payment it cannot see, and then had
-- nothing to resolve against: payment_intent.processing and
-- payment_intent.payment_failed were logged to the console and written
-- nowhere, so nothing distinguished "still settling" from "failed" from
-- "abandoned". A customer whose payment failed was told there was nothing else
-- they needed to do.
--
-- Deliberately SEPARATE from invoices.status. That column drives the job
-- pipeline (sent -> paid) and every projection built on it; an intermediate
-- value there would be read as progress by code that has no concept of one.
-- This column is advisory: it never gates settlement, which stays webhook
-- driven through settlePaidJob.

alter table invoices
  -- null on every existing row and on any invoice Stripe has said nothing
  -- about yet. 'processing' and 'failed' are the only values written; a paid
  -- invoice is identified by invoices.status/paid_at as it always was, so
  -- there is no 'paid' value here to drift out of agreement with them.
  add column payment_status text
    check (payment_status in ('processing', 'failed')),
  -- Stripe's own reason for the failure, message and code only. Never the full
  -- PaymentIntent: it carries customer payment-method detail that has no
  -- business being in our database, and this column is read to word a
  -- customer-facing message, not to reconstruct Stripe's state.
  add column last_payment_error jsonb;

-- The customer's pending page polls by invoice id, which is the primary key,
-- so no index is needed for the read path this exists to serve.
