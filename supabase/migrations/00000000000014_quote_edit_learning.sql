-- Learning loop: capture what a contractor actually changes between the
-- AI-drafted quote and what they send to a customer, so future drafts can
-- be steered by the contractor's own real corrections instead of only
-- retrieving raw past-quote text for the model to infer patterns from.

-- Immutable snapshot of the line items as first drafted (after deterministic
-- rate-card overrides, before any human edit) — the true baseline the
-- contractor reacted to. line_items_json keeps mutating as they edit/save;
-- this column never does.
alter table quotes add column drafted_line_items_json jsonb;

create table quote_line_edits (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  quote_id uuid not null references quotes (id) on delete cascade,
  description text not null,
  normalized_description text generated always as (lower(trim(description))) stored,
  category text not null,
  edit_type text not null check (edit_type in ('modified', 'added', 'removed')),
  drafted_quantity numeric(10, 2),
  drafted_unit_price numeric(10, 2),
  drafted_multiplier numeric(10, 2),
  final_quantity numeric(10, 2),
  final_unit_price numeric(10, 2),
  final_multiplier numeric(10, 2),
  created_at timestamptz not null default now()
);

create index quote_line_edits_contractor_idx
  on quote_line_edits (contractor_id, category);
create index quote_line_edits_contractor_desc_idx
  on quote_line_edits (contractor_id, normalized_description);

alter table quote_line_edits enable row level security;

create policy "Owner scoped via contractor" on quote_line_edits for all
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
