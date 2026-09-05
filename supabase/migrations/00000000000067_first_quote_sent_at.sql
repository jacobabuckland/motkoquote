-- NOTIF-3: Add first_quote_sent_at column to contractors
-- Tracks when a contractor sends their first quote from any device (app or web),
-- used to trigger the in-app push permission prompt at the right moment.

alter table contractors
  add column first_quote_sent_at timestamp with time zone;

-- Backfill: set first_quote_sent_at to created_at for contractors who have already
-- sent quotes (any quote with status != 'draft'). This ensures existing contractors
-- who have sent quotes will trigger the prompt on their next app open.
update contractors
set first_quote_sent_at = created_at
where exists (select 1 from jobs join quotes on quotes.job_id = jobs.id where jobs.contractor_id = contractors.id and quotes.status != 'draft')
and first_quote_sent_at is null;
