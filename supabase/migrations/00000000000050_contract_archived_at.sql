-- H2: archiving a resolved contract hides it from the dashboard. It never
-- deletes it.
--
-- A signed contract is a legal artefact. This column is the whole mechanism:
-- there is no delete endpoint, no soft-delete flag that anything treats as
-- gone, and nothing here touches `status`, `signer_name`, `signed_at` or
-- `declined_at`. Archiving is a view preference that happens to be stored on
-- the row, and restoring is setting it back to null.
--
-- Nullable timestamptz rather than a boolean, for the same reason the rest of
-- this schema uses timestamps: "when" is free to record and answers questions
-- "whether" cannot.
alter table contracts add column archived_at timestamptz;

-- RLS: nothing to add.
--
-- 00000000000020_contracts_rls.sql puts ONE policy on this table, "Owner scoped
-- via quote", declared `for all` and scoped by joining quote -> job ->
-- contractor -> owner_user_id = auth.uid(), with a matching `with check`. It is
-- row-level and column-agnostic, so a new column is covered on read and on
-- write the moment it exists: a user cannot select, archive or restore another
-- account's contract, because they cannot see the row at all.
--
-- Stated rather than assumed. The alternative reading — that a new column needs
-- a new policy — would have produced a redundant second policy on a table whose
-- access is already total, and `for all` with two policies is a union, so the
-- redundant one could only ever widen access.
--
-- The dashboard filters `archived_at is null` in the QUERY, not in the
-- component, so the row limit counts what is actually shown. This index is what
-- keeps that filter cheap as the archive grows.
create index if not exists contracts_archived_at_idx
  on contracts (archived_at)
  where archived_at is null;
