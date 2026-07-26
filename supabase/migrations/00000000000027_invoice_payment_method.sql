-- How an invoice was actually paid. Set at settlement for every paid invoice:
-- 'motko_bank' for a TrueLayer pay-by-bank pay-in (the on-rails default), or
-- 'cash' / 'bank_transfer' / 'other' when the trade marks it paid manually
-- because the customer paid them off-rails. Nullable: unpaid invoices have no
-- method yet, and rows paid before this column existed stay null (they were all
-- on-rails). Purely descriptive — the fee accrues per paid job regardless of
-- method, so this column never gates money logic, only what the receipt and
-- timeline show.
alter table invoices add column payment_method text;
