alter table invoices add column invoice_type text not null default 'final';
alter table invoices add column stripe_payment_link_id text;
alter table invoices add column stripe_payment_link_url text;
alter table invoices add column paid_at timestamptz;
