-- Payment stages table for splitting high-value jobs into multiple payments
-- under the Pay by Bank ceiling (£10k). Each stage generates its own invoice
-- and settles independently. A job above the ceiling gets a two-stage default
-- (deposit and balance); below it, stages are optional.
--
-- TWO CORRECTIONS after the first apply attempt failed on production, 6 Sep.
-- Both are recorded here rather than quietly fixed, because the second one is
-- the more dangerous and it did NOT stop the apply.
--
-- 1. The trigger called `set_updated_at()`, which does not exist in this
--    database. There is no generic one: migration 51 established the
--    convention of a table-specific function (`quotes_set_updated_at`), and
--    that is what this now follows. This is the error that stopped the push:
--    `function set_updated_at() does not exist (SQLSTATE 42883)`.
--
-- 2. Every RLS policy compared `jobs.contractor_id = auth.uid()`, which can
--    NEVER match. `jobs.contractor_id` holds a `contractors.id`; `auth.uid()`
--    is a user id. Ownership runs through `contractors.owner_user_id`, which
--    is the pattern every policy in migration 1 uses. Checked against
--    production rather than reasoned about: 61 jobs join contractors on
--    `c.id = j.contractor_id`, and 0 join on `c.owner_user_id =
--    j.contractor_id`.
--
--    The job page, `dashboard/actions.ts` and `invoicing.ts` all reach this
--    table through the USER-scoped client, so the policies bite for real. As
--    written, a contractor could not see their own stages, could not create
--    them, and could not link an invoice to one — the feature would have
--    shipped dead behind RLS, silently, with the migration reporting success.
--
-- ROLLBACK: drop table payment_stages;
--           drop function if exists payment_stages_set_updated_at();

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

-- Owner-scoped through the job's contractor, matching the "Owner scoped via
-- contractor" policies in migration 1. Service-role writes (settle-paid-job.ts
-- stamping settled_at from the webhook) bypass RLS and are unaffected.
create policy "Contractors can view stages for their jobs"
  on payment_stages for select
  using (
    job_id in (
      select j.id from jobs j
      join contractors c on c.id = j.contractor_id
      where c.owner_user_id = auth.uid()
    )
  );

create policy "Contractors can create stages for their jobs"
  on payment_stages for insert
  with check (
    job_id in (
      select j.id from jobs j
      join contractors c on c.id = j.contractor_id
      where c.owner_user_id = auth.uid()
    )
  );

-- `using` selects the rows that may be updated; `with check` constrains what
-- they may become. Both are needed, or a stage can be re-pointed at another
-- trade's job by an UPDATE that the `using` clause happily admitted.
create policy "Contractors can update stages for their jobs"
  on payment_stages for update
  using (
    job_id in (
      select j.id from jobs j
      join contractors c on c.id = j.contractor_id
      where c.owner_user_id = auth.uid()
    )
  )
  with check (
    job_id in (
      select j.id from jobs j
      join contractors c on c.id = j.contractor_id
      where c.owner_user_id = auth.uid()
    )
  );

-- Stamps updated_at on every write. Table-specific rather than generic,
-- following migration 51: there is no shared `set_updated_at()` in this
-- database, and assuming one is what failed the first apply.
create or replace function payment_stages_set_updated_at() returns trigger
  language plpgsql
  -- Empty search_path: this runs on every stage write, so it must not resolve
  -- an unqualified name through a caller-controlled path.
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payment_stages_set_updated_at on payment_stages;

create trigger payment_stages_set_updated_at
  before update on payment_stages
  for each row
  execute function payment_stages_set_updated_at();
