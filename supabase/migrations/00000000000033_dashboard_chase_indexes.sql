-- L4 (#19) — index the join and filter columns the dashboard and chase cron hit.
--
-- Postgres does NOT auto-index foreign-key columns, so every nested read the
-- dashboard makes (quotes→jobs→customers, invoices→quotes→jobs) and every RLS
-- predicate that scopes rows to the owning contractor was doing sequential scans
-- that grow linearly with total rows across all trades. These btree indexes turn
-- those joins and the status filters into index lookups.
--
-- contracts(quote_id) is already covered by the UNIQUE constraint on that column
-- (migration 0011); chase_events(invoice_id) is the leftmost column of the
-- unique index added in 0029 — neither is repeated here.

-- FK / join columns.
create index jobs_contractor_id_idx on jobs (contractor_id);
create index jobs_customer_id_idx on jobs (customer_id);
create index quotes_job_id_idx on quotes (job_id);
create index invoices_quote_id_idx on invoices (quote_id);

-- Status filters used by the dashboard pipeline sections.
create index quotes_status_idx on quotes (status);
create index contracts_status_idx on contracts (status);

-- Chase cron selects `status = 'sent' and due_date is not null`; the dashboard
-- filters open invoices by status. A composite on (status, due_date) serves both.
create index invoices_status_due_date_idx on invoices (status, due_date);
