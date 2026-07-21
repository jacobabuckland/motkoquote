import type { SupabaseClient } from "@supabase/supabase-js";

// The append-only credit_events ledger is the source of truth for how many
// fee-free jobs a trade has left; contractors.free_jobs_remaining is a cache the
// settlement path read-modify-writes. A rare concurrent write can drift the
// cache, so this nightly job recomputes each cache from the ledger sum and
// corrects any that disagree. The arithmetic is pulled out pure so it's unit
// testable without a database.

export type LedgerDelta = { contractor_id: string; delta: number };
export type CachedBalance = { id: string; free_jobs_remaining: number };
export type FreeJobsCorrection = {
  contractorId: string;
  from: number;
  to: number;
};

// Given every ledger delta and every cached balance, returns only the caches
// that disagree with the ledger sum (empty when everything reconciles). A
// contractor with no ledger rows reconciles to 0.
export const computeFreeJobsCorrections = (
  events: LedgerDelta[],
  contractors: CachedBalance[],
): FreeJobsCorrection[] => {
  const sums = new Map<string, number>();
  for (const event of events) {
    sums.set(event.contractor_id, (sums.get(event.contractor_id) ?? 0) + event.delta);
  }

  const corrections: FreeJobsCorrection[] = [];
  for (const contractor of contractors) {
    const truth = sums.get(contractor.id) ?? 0;
    if (truth !== contractor.free_jobs_remaining) {
      corrections.push({
        contractorId: contractor.id,
        from: contractor.free_jobs_remaining,
        to: truth,
      });
    }
  }
  return corrections;
};

// Recomputes every trade's free-jobs cache from the ledger and writes back only
// the ones that drifted. Service-role only. Returns a small summary for the
// cron response/logs.
export const reconcileFreeJobs = async (
  admin: SupabaseClient,
): Promise<{ checked: number; corrected: number }> => {
  const [{ data: events }, { data: contractors }] = await Promise.all([
    admin.from("credit_events").select("contractor_id, delta"),
    admin.from("contractors").select("id, free_jobs_remaining"),
  ]);

  const corrections = computeFreeJobsCorrections(
    (events ?? []) as LedgerDelta[],
    (contractors ?? []) as CachedBalance[],
  );

  for (const correction of corrections) {
    await admin
      .from("contractors")
      .update({ free_jobs_remaining: correction.to })
      .eq("id", correction.contractorId);
  }

  return { checked: contractors?.length ?? 0, corrected: corrections.length };
};
