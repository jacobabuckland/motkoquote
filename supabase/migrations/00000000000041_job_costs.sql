-- LED-2: Cost entry and job-level P&L view
-- Tracks costs incurred on jobs (materials, subcontractor costs, equipment hire)
-- to compute job-level profit and loss.

create table job_costs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  description text not null,
  amount_pence integer not null,
  category text,
  counterparty text,
  incurred_on date not null,
  vat_treatment text not null check (vat_treatment in ('standard', 'zero', 'exempt')),
  paid boolean not null default false,
  paid_on date,
  created_at timestamptz not null default now()
);

-- Enable row level security on job_costs (contractor-scoped via job → contractor → owner_user_id)
alter table job_costs enable row level security;

-- Policy: contractor can access via contractor.owner_user_id = auth.uid()
create policy "Contractor scoped via job" on job_costs for all
  using (job_id in (
    select j.id from jobs j
    join contractors c on c.id = j.contractor_id
    where c.owner_user_id = auth.uid()
  ))
  with check (job_id in (
    select j.id from jobs j
    join contractors c on c.id = j.contractor_id
    where c.owner_user_id = auth.uid()
  ));

-- Index for job page queries
create index job_costs_job_id_idx on job_costs (job_id);
