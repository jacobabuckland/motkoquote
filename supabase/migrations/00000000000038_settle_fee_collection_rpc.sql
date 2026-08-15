-- Issue #226: Atomic fee collection settlement via RPC
-- This RPC combines three post-claim effects into a single transaction:
-- 1. Mark the collection as collected
-- 2. Flip the collection's jobs from accrued to collected
-- 3. Set the contractor's billing status to active

create or replace function settle_fee_collection(
  p_fee_collection_id uuid,
  p_provider_ref text,
  p_now timestamptz
)
returns void
language plpgsql
security definer
as $$
declare
  v_contractor_id uuid;
  v_job_ids uuid[];
begin
  -- Update fee_collections and capture contractor_id + job_ids for subsequent updates.
  -- WHERE status != 'collected' ensures idempotency: if already collected, this
  -- returns NULL and we skip the remaining writes.
  update fee_collections
  set
    status = 'collected',
    collected_at = p_now,
    provider_collection_ref = case
      when p_provider_ref is not null then p_provider_ref
      else provider_collection_ref
    end
  where id = p_fee_collection_id
    and status != 'collected'
  returning contractor_id, job_ids
  into v_contractor_id, v_job_ids;

  -- If the collection was already collected, the update matched nothing and
  -- v_contractor_id is NULL. Return early as a no-op.
  if v_contractor_id is null then
    return;
  end if;

  -- Flip jobs from accrued to collected. Only touch jobs still at accrued status
  -- for idempotency (redelivery won't re-flip already-collected jobs).
  if array_length(v_job_ids, 1) > 0 then
    update jobs
    set fee_status = 'collected'
    where fee_status = 'accrued' and id = any(v_job_ids);
  end if;

  -- Return contractor to active billing status. Safe even if already active.
  update contractors
  set fee_collection_status = 'active'
  where id = v_contractor_id;
end;
$$;
