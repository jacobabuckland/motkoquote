-- TradeQuote initial data model
-- See docs/build-plan.pdf for the reference schema this implements.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table contractors (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  company_name text not null,
  company_number text,
  trade text,
  branding jsonb not null default '{}'::jsonb,
  vat_registered boolean not null default false,
  vat_number text,
  day_rate numeric(10, 2),
  overtime_rate numeric(10, 2),
  callout_min numeric(10, 2),
  travel_rate numeric(10, 2),
  markup_pct numeric(5, 2),
  created_at timestamptz not null default now()
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  name text not null,
  role text,
  day_rate numeric(10, 2),
  created_at timestamptz not null default now()
);

create table merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text
);

create table merchant_accounts (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  merchant_id uuid not null references merchants (id) on delete cascade,
  trade_discount_pct numeric(5, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (contractor_id, merchant_id)
);

create table material_prices (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants (id) on delete cascade,
  sku text not null,
  description text,
  list_price numeric(10, 2) not null,
  scraped_at timestamptz not null default now()
);
create index material_prices_merchant_sku_idx on material_prices (merchant_id, sku);

create table customers (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  name text not null,
  contact jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  customer_id uuid references customers (id) on delete set null,
  source_audio_url text,
  transcript text,
  extracted_json jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  line_items_json jsonb not null default '[]'::jsonb,
  total numeric(10, 2) not null default 0,
  pdf_url text,
  status text not null default 'draft',
  sent_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes (id) on delete cascade,
  stripe_invoice_id text,
  amount numeric(10, 2) not null,
  due_date date,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table chase_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  channel text not null,
  sent_at timestamptz not null default now(),
  template_used text
);

create table knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  embedding vector(1536),
  content text not null,
  source_type text not null,
  created_at timestamptz not null default now()
);
create index knowledge_chunks_embedding_idx on knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

-- Row Level Security: contractors only see their own data.
alter table contractors enable row level security;
alter table team_members enable row level security;
alter table merchant_accounts enable row level security;
alter table customers enable row level security;
alter table jobs enable row level security;
alter table quotes enable row level security;
alter table invoices enable row level security;
alter table chase_events enable row level security;
alter table knowledge_chunks enable row level security;

create policy "Contractors manage own row"
  on contractors for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "Owner scoped via contractor" on team_members for all
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

create policy "Owner scoped via contractor" on merchant_accounts for all
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

create policy "Owner scoped via contractor" on customers for all
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

create policy "Owner scoped via contractor" on jobs for all
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

create policy "Owner scoped via job" on quotes for all
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

create policy "Owner scoped via quote" on invoices for all
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

create policy "Owner scoped via invoice" on chase_events for all
  using (invoice_id in (
    select i.id from invoices i
    join quotes q on q.id = i.quote_id
    join jobs j on j.id = q.job_id
    join contractors c on c.id = j.contractor_id
    where c.owner_user_id = auth.uid()
  ))
  with check (invoice_id in (
    select i.id from invoices i
    join quotes q on q.id = i.quote_id
    join jobs j on j.id = q.job_id
    join contractors c on c.id = j.contractor_id
    where c.owner_user_id = auth.uid()
  ));

create policy "Owner scoped via contractor" on knowledge_chunks for all
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- merchants and material_prices are shared reference data, readable by all authenticated users.
alter table merchants enable row level security;
alter table material_prices enable row level security;

create policy "Authenticated read" on merchants for select
  using (auth.role() = 'authenticated');
create policy "Authenticated read" on material_prices for select
  using (auth.role() = 'authenticated');
