-- Job costs and counterparties data model (LED-1: ledger foundation)
--
-- motko knows what was quoted, invoiced and collected, but has no idea what a
-- job COST. This migration creates the data foundation for tracking job costs
-- and the counterparties (suppliers, subcontractors) who are paid.
--
-- All money columns are in *pennies* (int), matching the convention from
-- migration 00000000000023_pricing_referral.sql. The existing invoices.amount
-- and quotes.total are numeric pounds — never mix the two conventions.

-- ---------------------------------------------------------------------------
-- counterparties — suppliers, subcontractors, and other payees
-- Making these first-class entities (rather than free text on a cost line)
-- enables "you owe Frank £2,000 across four jobs" projections later.
-- ---------------------------------------------------------------------------
create table counterparties (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('supplier', 'subcontractor', 'other')),
  created_at timestamptz not null default now()
);

create index counterparties_contractor_idx on counterparties (contractor_id);

-- ---------------------------------------------------------------------------
-- job_costs — one row per cost incurred against a job
-- Positive amounts = money OUT (costs). Negative = money IN (refunds/credits).
-- ---------------------------------------------------------------------------
create table job_costs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete restrict,
  contractor_id uuid not null references contractors (id) on delete cascade,
  counterparty_id uuid references counterparties (id) on delete set null,
  description text not null,
  amount_net int not null,  -- integer pence, never floats
  vat_amount int,  -- integer pence, nullable
  vat_treatment text not null default 'unknown'
    check (vat_treatment in ('standard', 'zero', 'exempt', 'reverse_charge', 'unknown')),
  category text not null
    check (category in ('materials', 'labour', 'subcontractor', 'plant_hire', 'other')),
  incurred_on date not null,
  paid boolean not null default false,
  paid_on date,
  evidence_url text,  -- receipt photo, added in LED-3
  source text not null check (source in ('voice', 'photo', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_costs_job_idx on job_costs (job_id);
create index job_costs_contractor_idx on job_costs (contractor_id);
create index job_costs_counterparty_idx on job_costs (counterparty_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: contractor-scoped access
-- A contractor sees only their own rows; cross-tenant access is impossible.
-- ---------------------------------------------------------------------------
alter table counterparties enable row level security;
alter table job_costs enable row level security;

-- counterparties: read policy
create policy "Contractors can view their own counterparties"
  on counterparties for select
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- counterparties: insert policy (for create-on-miss matching)
create policy "Contractors can create their own counterparties"
  on counterparties for insert
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- counterparties: update policy
create policy "Contractors can update their own counterparties"
  on counterparties for update
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- counterparties: delete policy
create policy "Contractors can delete their own counterparties"
  on counterparties for delete
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- job_costs: read policy
create policy "Contractors can view their own job costs"
  on job_costs for select
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- job_costs: insert policy
create policy "Contractors can create their own job costs"
  on job_costs for insert
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- job_costs: update policy
create policy "Contractors can update their own job costs"
  on job_costs for update
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- job_costs: delete policy
create policy "Contractors can delete their own job costs"
  on job_costs for delete
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- Down migration (for rollback):
-- drop policy "Contractors can delete their own job costs" on job_costs;
-- drop policy "Contractors can update their own job costs" on job_costs;
-- drop policy "Contractors can create their own job costs" on job_costs;
-- drop policy "Contractors can view their own job costs" on job_costs;
-- drop policy "Contractors can delete their own counterparties" on counterparties;
-- drop policy "Contractors can update their own counterparties" on counterparties;
-- drop policy "Contractors can create their own counterparties" on counterparties;
-- drop policy "Contractors can view their own counterparties" on counterparties;
-- drop table job_costs;
-- drop table counterparties;
