-- H1: the date a contract reached its terminal state.
--
-- The dashboard's "Signed & declined contracts" list orders by signed_at, and
-- a declined contract has none — contracts record `status = 'declined'` and
-- nothing else (src/app/c/[id]/actions.ts). So every decline sorted to the end
-- of the list behind every signature, regardless of when it happened, and no
-- date could be shown against it at all.
--
-- Quotes already got this right: quotes.declined_at has existed since the quote
-- response flow was built. Contracts are the outlier, not the precedent.
--
-- Nullable, like signed_at and sent_at beside it. A contract that is still
-- 'sent' has not been declined and must not carry a date saying it was.
alter table contracts add column declined_at timestamptz;

-- Backfill. There is no record of WHEN an existing decline happened — that is
-- the defect — so created_at is the only defensible floor: the decline cannot
-- have preceded the contract existing. It is wrong in the sense of imprecise,
-- and it is not wrong in the sense of misleading, because the alternative is a
-- row that sorts as though it never resolved.
--
-- Deliberately NOT coalescing to now(): stamping today's date on a decline from
-- three months ago would put stale rows at the top of the list, which is worse
-- than putting them at the bottom.
update contracts
  set declined_at = created_at
  where status = 'declined' and declined_at is null;

-- The single date the list sorts by.
--
-- A signature and a decline are the same KIND of event to this list — the
-- moment the contract stopped being open — but they live in different columns,
-- and PostgREST cannot order by an expression. Ordering by signed_at alone put
-- every decline behind every signature forever; ordering in the client is worse
-- still, because the query takes the newest 10 and the client would only be
-- re-sorting whichever 10 the wrong order happened to return.
--
-- Generated and stored, so it is a real column with a real index and cannot
-- drift from the two it derives from. coalesce, not greatest: a contract is
-- signed or declined, never both, and the state machine in
-- src/app/c/[id]/actions.ts enforces that by asserting the prior status.
alter table contracts
  add column status_changed_at timestamptz
  generated always as (coalesce(signed_at, declined_at)) stored;

-- The list reads (status, status_changed_at) together.
create index if not exists contracts_status_changed_at_idx
  on contracts (status, status_changed_at desc);
