-- Fee collection via commercial VRP (cVRP) — mandate lifecycle + dunning.
--
-- Phase 3 accrues a per-paid-job fee (jobs.fee_status = 'accrued'). This phase
-- collects those fees monthly by pulling them, via a TrueLayer commercial VRP
-- mandate the trade authorised once, into motko's merchant account. A charge
-- that fails enters dunning: retried on a schedule, and if it never clears the
-- trade's billing is paused (contractors.fee_collection_status = 'paused') for a
-- human to follow up.
--
-- contractors.fee_mandate_id (the mandate reference) and fee_collection_status
-- ('active'|'past_due'|'paused') already exist from migration 023. This adds the
-- mandate authorisation state and the per-collection dunning bookkeeping.

-- Mandate authorisation lifecycle, mirroring TrueLayer's mandate status. Null
-- until the trade starts setup; 'authorized' is the only state we can charge in.
alter table contractors add column fee_mandate_status text
  check (fee_mandate_status in
    ('authorization_required', 'authorizing', 'authorized', 'failed', 'revoked'));

-- Dunning bookkeeping on each collection. `attempts` counts charge tries made so
-- far (0 until the first charge); `last_attempt_at` gates the retry interval;
-- `failure_reason` records why the most recent charge failed for diagnosis.
alter table fee_collections add column attempts int not null default 0;
alter table fee_collections add column last_attempt_at timestamptz;
alter table fee_collections add column failure_reason text;
