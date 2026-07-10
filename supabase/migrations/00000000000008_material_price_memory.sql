create table contractor_material_prices (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  description text not null,
  normalized_description text generated always as (lower(trim(description))) stored,
  unit text,
  unit_price numeric(10, 2) not null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (contractor_id, normalized_description)
);
create index contractor_material_prices_contractor_idx
  on contractor_material_prices (contractor_id);

alter table contractor_material_prices enable row level security;

create policy "Owner scoped via contractor" on contractor_material_prices for all
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
