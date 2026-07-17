-- Critical fix: contracts was created (00000000000011_contracts.sql) without
-- row level security. Every other financial-document table (jobs, quotes,
-- invoices) is owner-scoped via RLS — contracts was left wide open, so any
-- authenticated contractor could read every other contractor's contracts.
-- Public/customer-facing access (src/app/c/[id]) goes through the service-role
-- admin client and bypasses RLS entirely, so this does not affect that flow.

alter table contracts enable row level security;

create policy "Owner scoped via quote" on contracts for all
  using (quote_id in (
    select q.id from quotes q
    join jobs j on j.id = q.job_id
    join contractors c on c.id = j.contractor_id
    where c.owner_user_id = auth.uid()
  ))
  with check (quote_id in (
    select q.id from quotes q
    join jobs j on j.id = q.job_id
    join contractors c on c.id = j.contractor_id
    where c.owner_user_id = auth.uid()
  ));
