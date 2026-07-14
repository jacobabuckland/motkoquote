-- Soft-delete + scheduled purge for contractor accounts.
-- Deleting an account is a two-stage process: the contractor is soft-deleted
-- immediately (signed out, flagged) and a purge is scheduled 30 days out. A
-- daily cron then anonymises their personal data while retaining issued
-- invoices/contracts in anonymised form for legal/tax record-keeping.
--
-- We deliberately do NOT delete the auth user or cascade-delete the contractor
-- row on purge: quotes -> invoices/contracts chain up to the contractor via ON
-- DELETE CASCADE, so removing the row (or the auth user) would destroy exactly
-- the financial records we are required to keep. Purge anonymises in place.

alter table contractors
  add column deleted_at timestamptz,
  add column purge_after timestamptz,
  add column purged_at timestamptz;

-- Lets the purge cron efficiently find accounts whose grace period has elapsed
-- and that haven't been purged yet.
create index contractors_purge_due_idx
  on contractors (purge_after)
  where purged_at is null and purge_after is not null;
