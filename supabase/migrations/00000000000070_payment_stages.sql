-- Payment stages table for splitting high-value jobs into multiple payments
-- under the Pay by Bank ceiling (£10k). Each stage generates its own invoice
-- and settles independently. A job above the ceiling gets a two-stage default
-- (deposit and balance); below it, stages are optional.

create table payment_stages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  stage_number int not null check (stage_number > 0),
  amount_pennies int not null check (amount_pennies > 0),
  invoice_id uuid references invoices(id) on delete set null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (job_id, stage_number)
);

-- Index for looking up stages by job
create index idx_payment_stages_job_id on payment_stages(job_id);

-- Index for looking up stage by invoice when settlement happens
create index idx_payment_stages_invoice_id on payment_stages(invoice_id);

-- Row-level security
alter table payment_stages enable row level security;

-- Contractors can read their own job's stages
create policy "Contractors can view stages for their jobs"
  on payment_stages for select
  using (
    exists (
      select 1 from jobs
      where jobs.id = payment_stages.job_id
      and jobs.contractor_id = auth.uid()
    )
  );

-- Contractors can insert stages for their own jobs
create policy "Contractors can create stages for their jobs"
  on payment_stages for insert
  with check (
    exists (
      select 1 from jobs
      where jobs.id = payment_stages.job_id
      and jobs.contractor_id = auth.uid()
    )
  );

-- Contractors can update stages for their own jobs
create policy "Contractors can update stages for their jobs"
  on payment_stages for update
  using (
    exists (
      select 1 from jobs
      where jobs.id = payment_stages.job_id
      and jobs.contractor_id = auth.uid()
    )
  );

-- Trigger to update updated_at timestamp
create trigger set_updated_at
  before update on payment_stages
  for each row
  execute function set_updated_at();
