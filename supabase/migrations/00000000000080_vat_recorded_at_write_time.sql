-- VAT is recorded when money is written down, not inferred when it is read.
--
-- WHY. Nothing stored VAT. Every surface recomputed it from the contractor's
-- CURRENT `vat_registered` flag, which made three separate defects on 13 Sep
-- one defect:
--
--   * The job page reads the stored `quotes.total` while /q/[id] recomputes
--     from live line items. Toggling registration without re-saving made them
--     disagree by exactly 1.2x — £6,000 against £7,200 on one job.
--   * "Money in and out" applied today's flag to all £13,062 ever collected and
--     set aside £2,177 of VAT, including on £11,288 taken before registration
--     when none was charged.
--   * `invoices` has a single `amount` column, so the P&L's "Invoiced (net)"
--     was gross, sitting beside costs that genuinely are net.
--
-- A figure a customer was charged is a historical fact. Recomputing it from a
-- flag that can change means the app restates its own past every time the trade
-- registers, deregisters, or the rate moves.
--
-- NULLABLE, AND NULL MEANS UNKNOWN — not zero.
--
-- These columns are deliberately not backfilled. The app has no record of WHEN
-- registration happened, so there is no sound way to say which historic rows
-- carried VAT: a blanket backfill from the current flag is precisely the bug
-- above, performed once and made permanent. Rows written from here on carry the
-- answer; older rows say "not recorded", and the surfaces that read them say so
-- rather than guessing.

-- quotes.total is, and remains, VAT-INCLUSIVE. These two record how it splits.
alter table quotes
  add column if not exists subtotal numeric(10, 2),
  add column if not exists vat_amount numeric(10, 2);

comment on column quotes.subtotal is
  'Net of VAT, as computed when this quote was last written. NULL on quotes written before VAT was recorded at write time — not zero.';
comment on column quotes.vat_amount is
  'VAT included in `total`, as computed when this quote was last written. NULL means not recorded, never that no VAT applied.';

-- invoices.amount is, and remains, what the customer is asked to pay.
alter table invoices
  add column if not exists vat_amount numeric(10, 2);

comment on column invoices.vat_amount is
  'VAT included in `amount`, recorded when the invoice was raised. NULL means not recorded, never that no VAT applied. Net is `amount - vat_amount` only where this is non-null.';

-- The rate in force when the row was written, so a future change to the UK rate
-- cannot restate what was charged at 20%. Stored per row rather than read from
-- a constant for the same reason the amounts are.
alter table quotes add column if not exists vat_rate numeric(5, 4);
alter table invoices add column if not exists vat_rate numeric(5, 4);

comment on column quotes.vat_rate is
  'The VAT rate applied when this quote was last written, e.g. 0.2000. NULL where not recorded.';
comment on column invoices.vat_rate is
  'The VAT rate applied when this invoice was raised, e.g. 0.2000. NULL where not recorded.';
