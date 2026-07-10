-- Stage 3: measurement-based rate cards. A contractor's per-unit prices for
-- specific work types (e.g. "Rewire" per "circuit", "Plastering" per "m2"),
-- consulted by the quote drafter so quotes use confirmed rates instead of
-- guessed ones wherever a match exists.
create table rate_cards (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  work_type text not null,
  unit text not null,
  rate_per_unit numeric(10, 2) not null,
  complexity_notes text,
  created_at timestamptz not null default now()
);

alter table rate_cards enable row level security;

create policy "Owner scoped via contractor" on rate_cards for all
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
