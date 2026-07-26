-- M5 (#16) — never let a deleted quote destroy issued financial records.
--
-- invoices.quote_id and contracts.quote_id were declared ON DELETE CASCADE, so
-- deleting a quote silently cascade-deleted every invoice and contract raised
-- against it. Issued invoices and signed contracts are legal/tax records we are
-- required to retain (in anonymised form) — they must survive the deletion of a
-- parent quote, not be purged with it.
--
-- The retention path anonymises rather than hard-deletes, so in normal operation
-- these cascades never fire. Flipping both foreign keys to ON DELETE RESTRICT is
-- defence-in-depth: any future code path (or manual query) that tries to delete
-- a quote with live financial children now errors instead of destroying records.
--
-- Constraint names are the Postgres defaults for the inline `references quotes`
-- declarations in migrations 0001 (invoices) and 0011 (contracts).
alter table invoices
  drop constraint invoices_quote_id_fkey,
  add constraint invoices_quote_id_fkey
    foreign key (quote_id) references quotes (id) on delete restrict;

alter table contracts
  drop constraint contracts_quote_id_fkey,
  add constraint contracts_quote_id_fkey
    foreign key (quote_id) references quotes (id) on delete restrict;
