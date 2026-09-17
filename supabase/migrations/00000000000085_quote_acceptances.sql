-- PASS-14 SERIOUS 3: a second acceptance is never recorded, so the Activity log
-- keeps a figure the customer has since moved past.
--
-- Pass 14's job 1c053939: the customer accepted three times — £1,440 at 13:27,
-- then £1,800, then £1,800 again at a different deposit. The log records only
-- the first. There is no second "Quote accepted", no second "Quote viewed", and
-- the figure £1,800 appears nowhere in the history — yet the contract that was
-- signed and invoiced is the £1,800 one.
--
-- So the log reads: customer agreed £1,440 → quote re-issued → contract sent →
-- contract signed → deposit invoice paid. In a dispute months later that
-- supports the customer's position that they never agreed to £1,800. It is the
-- same harm migration 84 was written to prevent, relocated from the FIGURE to
-- the EVENT.
--
-- WHY A TABLE, AFTER TWO MIGRATIONS SAID "NOT THIS ITEM"
--
-- Migrations 82 and 84 both recorded that a full event history is an events
-- table and both deferred it, adding a column instead. That was right twice: a
-- column answered the question in front of us, and the cost of guessing at a
-- general events schema was real. It is not right a third time. The thing
-- pass 14 found cannot be answered by another column, because the shape of the
-- answer is a LIST — one row per acceptance — and a column holds one value.
--
-- `accepted_first_at` and `accepted_total` (82, 84) are what a single column
-- could do: they pin the FIRST acceptance so a re-issue cannot rewrite it. This
-- table is what they were standing in for.
--
-- SCOPE, deliberately narrow. This is the acceptance history, not a general
-- job-events table. The contract lifecycle needs no such table — every contract
-- row already carries its own sent_at, withdrawn_at, declined_at and signed_at,
-- and pass-14 SERIOUS 2 was fixed by reading all of them. Quote acceptance is
-- the one event in this product with nowhere to live, because a quote is one
-- row and can be accepted more than once.

create table if not exists quote_acceptances (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  -- WHEN they accepted, and WHAT they accepted. The second is captured at the
  -- moment of acceptance because `quotes.total` is overwritten by a re-issue,
  -- so it is the only moment it certainly names the accepted figure.
  accepted_at timestamptz not null,
  accepted_total numeric,
  created_at timestamptz not null default now()
);

comment on table quote_acceptances is
  'One row per customer acceptance of a quote, append-only. A quote may be accepted, re-issued and accepted again; quotes.accepted_at holds only the current state and quotes.accepted_first_at only the first, so neither can answer "what did they agree to, and when" for the second acceptance onwards. Feeds the job page Activity panel. Never updated, never deleted except by cascade.';

comment on column quote_acceptances.accepted_total is
  'The quote total at the moment of this acceptance. Null only where it could not be read — never guessed from the current total, which after a re-issue is the NEW figure wearing the old one''s clothes.';

-- Newest first is how the Activity panel reads, and how this is queried.
create index if not exists quote_acceptances_quote_id_accepted_at_idx
  on quote_acceptances (quote_id, accepted_at desc);

-- Owner-scoped exactly as contracts is (migration 20): quote -> job ->
-- contractor -> auth.uid(). The customer-facing accept path runs through the
-- service-role admin client and bypasses RLS, as it already does for the quote
-- update itself, so this policy governs the contractor reading their own
-- history and nothing else.
alter table quote_acceptances enable row level security;

create policy "Owner scoped via quote" on quote_acceptances for all
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

-- BACKFILL: exactly what is already known, and nothing more.
--
-- `accepted_first_at` is a real recorded acceptance, so it becomes a row, with
-- `accepted_total` beside it where migration 84 captured one. Quotes accepted
-- before 82 have neither and get no row — their Activity panel keeps reading
-- from the columns, which is what the fallback in buildTimeline is for.
--
-- SECOND AND LATER ACCEPTANCES ARE NOT BACKFILLED. They were never recorded
-- anywhere: `accepted_at` holds only the most recent, and a quote re-issued
-- after it has lost even that. Writing `accepted_at` as a second row would
-- assert a second acceptance for every quote accepted once, which is false for
-- almost all of them. A history that starts today is honest; an invented one is
-- the defect this table exists to end.
insert into quote_acceptances (quote_id, accepted_at, accepted_total)
select id, accepted_first_at, accepted_total
  from quotes
 where accepted_first_at is not null
   and not exists (
     select 1 from quote_acceptances a where a.quote_id = quotes.id
   );
