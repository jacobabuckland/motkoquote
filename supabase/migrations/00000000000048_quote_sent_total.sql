-- #370 — a sent quote is rewritten in place with no version, no re-send and
-- no disclosure.
--
-- Reported 26 Aug 2026: the customer's SMS carried £114; opening the link in
-- that same SMS showed £20. The SMS is a frozen artefact built from
-- quotes.total at send; the public page re-derives from line_items_json on
-- every request. Editing a sent quote is permitted (EDITABLE_STATUSES includes
-- "sent") and nothing recorded that the two had ever disagreed.
--
-- Two columns, for two different jobs:
--
--   sent_total  — what the customer was actually told, frozen at send. Without
--                 it there is no way to know a divergence exists, because the
--                 delivered figure is not stored anywhere: it lived only in the
--                 SMS body. This is the column the disclosure notice reads.
--
--   updated_at  — quotes has created_at, sent_at, viewed_at, accepted_at and
--                 declined_at, and no modification timestamp at all. The
--                 database could not answer "when did £114 become £20" at any
--                 access level. That is the gap this closes.

alter table quotes
  add column if not exists sent_total numeric(10,2),
  add column if not exists updated_at timestamptz not null default now();

comment on column quotes.sent_total is
  'The total as delivered to the customer, stamped at send by markSent. Null '
  'for a quote that has never been sent. Compared against the live total to '
  'decide whether the public page discloses a change (#370).';

comment on column quotes.updated_at is
  'Maintained by the quotes_set_updated_at trigger, not by application code. '
  'See the trigger comment for why (#370).';

-- Backfill to created_at rather than now(): stamping every historic row with
-- the migration time would assert that every quote ever written was modified
-- today, which is false and would make the column useless for exactly the
-- question it exists to answer. created_at is the last modification time we
-- can actually defend for a row we never tracked.
update quotes set updated_at = created_at where updated_at is not null;

-- A trigger, not application code.
--
-- This repo's existing convention is to set updated_at in the writer (see
-- cost-actions.ts, settings/actions.ts). That convention is what produced this
-- bug's blast radius: four separate actions write quotes.line_items_json or
-- quotes.total, and a guarantee that depends on each of them remembering is
-- not a guarantee. The whole value of this column is that it is true for every
-- write including ones not yet written, so it is enforced where writes
-- actually land.
create or replace function quotes_set_updated_at() returns trigger
  language plpgsql
  -- Empty search_path: this runs on every quote write, so it must not resolve
  -- an unqualified name through a caller-controlled path.
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function quotes_set_updated_at() is
  'Stamps quotes.updated_at on every UPDATE. Deliberately a trigger rather '
  'than application code: four actions write quote money and a per-writer '
  'convention is what let a post-send rewrite go unrecorded (#370).';

drop trigger if exists quotes_set_updated_at on quotes;

create trigger quotes_set_updated_at
  before update on quotes
  for each row
  execute function quotes_set_updated_at();
