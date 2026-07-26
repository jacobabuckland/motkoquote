-- M6 — apply the free-jobs cache delta atomically, not read-modify-write.
--
-- Settlement reconciled contractors.free_jobs_remaining by SELECTing the current
-- value then UPDATEing value + delta. Two settlements for the same contractor
-- (or the same one racing the nightly reconcile) could both read the same value
-- and one write would clobber the other, drifting the cache from the ledger.
--
-- The ledger (credit_events) stays the source of truth; this just keeps the
-- cache correct without a nightly repair by folding the delta in a single
-- statement, so concurrent settlements compose instead of overwriting.
create or replace function increment_free_jobs_remaining(p_id uuid, p_delta int)
returns void
language sql
as $$
  update contractors
  set free_jobs_remaining = free_jobs_remaining + p_delta
  where id = p_id;
$$;
