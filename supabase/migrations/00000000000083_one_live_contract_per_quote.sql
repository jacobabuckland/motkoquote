-- PASS-13 CRITICAL 1: a quote can never have a second contract, so a withdrawn
-- or declined one ends the job permanently.
--
-- `contracts.quote_id` has been UNIQUE since migration 11. That was right while
-- a contract was a one-way door, and wrong the moment CONTRACT-1 (#786) added
-- withdrawal and pass-12 SERIOUS 4 added recovery from a decline: the row stays
-- behind and holds the only slot, so the INSERT in `createContract` can never
-- succeed again whatever the old contract's status.
--
-- The visible cost was worse than a refusal. `createContract` caught the
-- duplicate-key error, read the existing row back, and returned
-- `alreadySent: true` — which the form treats as SUCCESS. The button landed on
-- "Sent ✓" and navigated away. Nothing was created, no "Contract sent" entry
-- appeared, and the contractor had no reason to think anything had failed. The
-- pass-13 reviewer left two jobs holding £2,160 of accepted work waiting for a
-- signature that could not arrive.
--
-- THE RULE IS ONE LIVE CONTRACT PER QUOTE, NOT ONE CONTRACT PER QUOTE. A
-- partial unique index says exactly that and nothing more: withdrawn and
-- declined contracts stay in the table as history, and at most one contract is
-- ever live.
--
-- Chosen over the two alternatives deliberately (Jacob, 16 Sep):
--
--   * Overwriting the withdrawn row in place needs no migration and is the
--     smallest change, but it destroys the withdrawn contract's body and its
--     `withdrawn_at` — a document the customer may already have opened stops
--     having existed. That is the precise opposite of migration 82, which was
--     written a day earlier to stop exactly this kind of erasure.
--   * A separate history table keeps every existing to-one embed working, at
--     the cost of two tables to hold in step and a /c/[id] route that must
--     still resolve links to moved rows.
--
-- READ THIS BEFORE MERGING CODE THAT DEPENDS ON IT. The embed
-- `contract:contracts(id, status)` is a to-ONE embed today *because* of the
-- UNIQUE constraint, and PostgREST decides to-one versus to-many from exactly
-- that. Dropping it turns every such embed into an ARRAY, and `.maybeSingle()`
-- on a quote with two contracts starts erroring. `hasContract` already handles
-- both shapes — it was written for this hazard — but every other reader must be
-- audited before the re-issue path lands. That audit is the follow-up item, not
-- this migration.
--
-- Additive and reversible: no row is written, moved or deleted, and the old
-- constraint can be restored by dropping the index and re-adding it, provided
-- no quote has yet acquired a second contract.

alter table contracts drop constraint if exists contracts_quote_id_key;

-- At most one contract per quote that is still live. `withdrawn` and `declined`
-- are excluded, so any number of them may accumulate as history.
create unique index if not exists contracts_one_live_per_quote
  on contracts (quote_id)
  where status not in ('withdrawn', 'declined');

comment on index contracts_one_live_per_quote is
  'One LIVE contract per quote. Withdrawn and declined contracts are history and do not hold the slot, so a contract can be re-issued after one is taken back or refused. Replaced the UNIQUE constraint from migration 11 (pass-13 CRITICAL 1).';
