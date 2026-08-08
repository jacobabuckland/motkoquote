-- Operator visibility for the fee-billing go-live (Workstream B).
--
-- Read-only diagnostics for a single trade. Paste a contractor id where marked
-- (all queries reference :cid via a psql \set; in the Supabase SQL editor just
-- replace 'CONTRACTOR_ID_HERE' inline). Nothing here writes — these mirror,
-- in SQL, exactly what src/lib/fee-runway.ts derives so a tester can confirm
-- which rung of the zero-free-jobs ladder a trade is on and why.
--
-- Money is in *pennies* (int) everywhere the fee model touches; divide by 100.0
-- for pounds. The blessed model: first 5 paid jobs free, then £2 per paid job
-- (£4 over £1,000), +5 free jobs per activated referral, collected monthly by
-- bank mandate. The £2/£4 fee is VAT-*inclusive* (net + vat == gross).

\set cid 'CONTRACTOR_ID_HERE'

-- ---------------------------------------------------------------------------
-- 1. Free-jobs ledger — the source of truth.
--    credit_events is append-only; sum(delta) MUST equal the cached
--    contractors.free_jobs_remaining (reconciled nightly). This surfaces any
--    drift between the ledger and the cache.
-- ---------------------------------------------------------------------------
select
  c.id                                                as contractor_id,
  c.company_name,
  c.free_jobs_remaining                               as cached_free_jobs,
  coalesce(sum(ce.delta), 0)                          as ledger_free_jobs,
  c.free_jobs_remaining - coalesce(sum(ce.delta), 0)  as drift  -- must be 0
from contractors c
left join credit_events ce on ce.contractor_id = c.id
where c.id = :'cid'
group by c.id, c.company_name, c.free_jobs_remaining;

-- 1b. The full ledger, newest first — every grant, referral unlock, job
--     consumption, refund and admin adjustment that built the balance above.
select
  created_at,
  delta,
  reason,          -- signup_grant | referral_unlock | job_consumed | refund_restore | admin_adjust
  related_job_id,
  related_referral_id
from credit_events
where contractor_id = :'cid'
order by created_at desc;

-- ---------------------------------------------------------------------------
-- 2. Accrued (uncollected) fees with the VAT-inclusive split.
--    These are the jobs feeding the banner's running total and the grace
--    countdown. gross == net + vat, always.
-- ---------------------------------------------------------------------------
select
  id                    as job_id,
  paid_at,
  job_value_pennies,
  fee_amount_pennies    as gross_pennies,
  fee_net_pennies       as net_pennies,
  fee_vat_pennies       as vat_pennies,
  fee_status
from jobs
where contractor_id = :'cid'
  and fee_status = 'accrued'
order by paid_at desc;

-- 2b. Accrued totals — the number shown in the runway banner, plus the count
--     that drives the grace window (paidJobsSinceAllowanceZero).
select
  count(*)                              as accrued_jobs,
  coalesce(sum(fee_amount_pennies), 0)  as accrued_gross_pennies,
  coalesce(sum(fee_net_pennies), 0)     as accrued_net_pennies,
  coalesce(sum(fee_vat_pennies), 0)     as accrued_vat_pennies
from jobs
where contractor_id = :'cid'
  and fee_status = 'accrued';

-- ---------------------------------------------------------------------------
-- 3. Fee-collection history (batched monthly pulls) with dunning state.
--    net_pennies / vat_pennies are the collection-level split; totals are
--    unchanged by the split (gross == net + vat).
-- ---------------------------------------------------------------------------
select
  period_start,
  period_end,
  status,                       -- pending | collected | failed
  total_pennies                 as gross_pennies,
  net_pennies,
  vat_pennies,
  cardinality(job_ids)          as job_count,
  attempts,
  last_attempt_at,
  failure_reason,
  provider_collection_ref,
  collected_at
from fee_collections
where contractor_id = :'cid'
order by period_start desc;

-- ---------------------------------------------------------------------------
-- 4. Mandate status — whether the trade can be charged at all.
--    'authorized' is the ONLY state a collection can run in; anything else
--    means fees keep accruing but nothing is pulled (and, at zero free jobs,
--    the runway ladder engages).
-- ---------------------------------------------------------------------------
select
  id                     as contractor_id,
  company_name,
  fee_mandate_id,
  fee_mandate_status,    -- null | authorization_required | authorizing | authorized | failed | revoked
  fee_collection_status  -- active | past_due | paused
from contractors
where id = :'cid';

-- ---------------------------------------------------------------------------
-- 5. Runway state — the exact rung of the ladder, computed the same way as
--    src/lib/fee-runway.ts (computeFeeRunway). Note this SQL does NOT read the
--    FEE_BILLING_ENABLED flag: with the flag OFF the app forces 'inactive'
--    (nothing shown, nothing blocked) regardless of the numbers below. This
--    shows what the trade WOULD see once the flag is on.
--      GRACE_PAID_JOBS = 3, PASSIVE_NUDGE_MAX_FREE_JOBS = 2.
-- ---------------------------------------------------------------------------
with facts as (
  select
    c.id,
    c.company_name,
    coalesce((select sum(delta) from credit_events where contractor_id = c.id), 0) as free_jobs,
    (c.fee_mandate_status = 'authorized')                                          as mandate_authorized,
    (select count(*) from jobs
       where contractor_id = c.id and fee_status = 'accrued')                      as accrued_jobs
  from contractors c
  where c.id = :'cid'
)
select
  company_name,
  free_jobs,
  mandate_authorized,
  accrued_jobs                             as paid_jobs_since_allowance_zero,
  greatest(0, 3 - accrued_jobs)            as grace_paid_jobs_remaining,
  case
    when mandate_authorized       then 'ok'
    when free_jobs > 2            then 'ok'
    when free_jobs > 0            then 'passive_nudge'
    when 3 - accrued_jobs > 0     then 'grace'
    else                              'blocked'
  end                                       as runway_state,
  case
    when mandate_authorized       then true
    when free_jobs > 0            then true
    when 3 - accrued_jobs > 0     then true
    else                              false
  end                                       as can_send_quote
from facts;
