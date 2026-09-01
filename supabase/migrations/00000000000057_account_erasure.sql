-- Real account erasure (replaces the soft-delete + 30-day purge of migration 17).
--
-- Migration 17 refused to delete the auth user, protecting the financial
-- records by preserving the identity — which left the auth user, its password
-- and its sessions fully intact behind a `deleted_at` flag that NO read path
-- ever consulted. A contractor who deleted their account on 2026-09-01 at
-- 07:14 signed back in with the old password at 07:36.
--
-- Its stated reason was that invoices and contracts chain up to the contractor
-- via ON DELETE CASCADE, so deleting the auth user would cascade them away.
-- That was true when it was written and is NOT true now: migration 30 flipped
-- invoices.quote_id and contracts.quote_id to ON DELETE RESTRICT, so on the
-- schema as it stands nothing is destroyed — the cascade hits the restrict and
-- the whole delete fails with a foreign-key violation instead. Verified rather
-- than assumed: replaying this migration chain against a scratch Postgres with
-- the old cascade restored, `delete from auth.users` errors with "violates
-- foreign key constraint invoices_quote_id_fkey".
--
-- The conclusion is unchanged: either way the auth user could not be deleted,
-- so erasure could never have worked. Only the failure mode differs — a hard
-- error rather than silent data loss.
--
-- This breaks the cascade instead of the erasure. contractors.owner_user_id
-- becomes nullable with ON DELETE SET NULL, so deleting the auth user detaches
-- the contractor row rather than destroying it. The row survives as a
-- pseudonymous shell — its own `id` is the non-reversible key the retained
-- financial records are joined on, and once owner_user_id is null there is no
-- join path back to the erased identity.

alter table contractors
  drop constraint contractors_owner_user_id_fkey;

alter table contractors
  alter column owner_user_id drop not null;

alter table contractors
  add constraint contractors_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users (id) on delete set null;

-- Marks a contractor row as an erased pseudonymous shell. Every read path that
-- resolves a contractor — including the public quote/contract/invoice pages —
-- must treat a non-null erased_at as "gone", which is what stops a customer's
-- saved link resolving to an erased trade's document.
alter table contractors
  add column erased_at timestamptz;

comment on column contractors.erased_at is
  'Set when the account was erased. The row is retained only as the anonymised '
  'parent of financial records; it has no owner and must never resolve to a '
  'live account.';

-- The old grace-period columns are left in place deliberately rather than
-- dropped. One production row still carries deleted_at/purge_after from the
-- 2026-09-01 incident, and dropping the columns would erase the only record
-- that it happened. Nothing reads or writes them any more: erasure is now
-- immediate (no grace period, no restore), and the purge cron is gone.
comment on column contractors.deleted_at is
  'DEPRECATED — the soft-delete grace period was removed in migration 57. '
  'Retained only as the audit trail of accounts flagged under the old scheme.';

-- Partial index for the erased-account guards on the public artefact routes.
create index contractors_erased_idx on contractors (id) where erased_at is not null;

-- The purge cron is retired along with the grace period. It held a row in
-- cron_locks while running, and an earlier draft of this migration deleted that
-- row here so a stale lock could not outlive the job.
--
-- That statement is gone, for two reasons. Migrations must be additive
-- (scripts/ci/migration-safety.ts), and it was a no-op regardless: production
-- was probed before this migration was applied and cron_locks held no
-- 'purge-accounts' row — the lock is written at the start of a run and released
-- in a finally block, so it only persists if a run dies mid-flight, which none
-- had. Nothing is left behind by leaving it alone.
