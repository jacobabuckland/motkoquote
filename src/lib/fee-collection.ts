// Fee-collection planning — pure, I/O-free arithmetic for the monthly cVRP
// batch and its dunning schedule. Kept deterministic and side-effect-free so it
// is trivially testable; the DB reads/writes and the TrueLayer mandate charge
// live in collect-fees.ts (I/O) and truelayer-vrp.ts (network).
//
// All money is in *pennies* (int), matching motko-fee.ts and the fee_collections
// table. Never mix with the pounds `invoices.amount` / `quotes.total` columns.

// One accrued job awaiting collection. Sourced from
// `jobs WHERE fee_status = 'accrued'`.
export type AccruedJob = {
  jobId: string;
  contractorId: string;
  feeAmountPennies: number;
};

// A single trade's batched collection: every accrued job rolled into one charge
// so the trade sees a single line ("motko — £18, 9 jobs") on their statement.
export type FeeCollectionPlan = {
  contractorId: string;
  jobIds: string[];
  totalPennies: number;
};

// Rolls accrued jobs up per trade into one collection each. Jobs with a
// non-positive fee are ignored (a waived job should never reach here, but we
// never bill £0). Output is fully ordered — contractors by id, job ids within a
// contractor by id — so a batch run is reproducible and diffable.
export const planFeeCollections = (jobs: AccruedJob[]): FeeCollectionPlan[] => {
  const byContractor = new Map<string, { jobIds: string[]; totalPennies: number }>();

  for (const job of jobs) {
    if (job.feeAmountPennies <= 0) continue;
    const existing = byContractor.get(job.contractorId) ?? {
      jobIds: [],
      totalPennies: 0,
    };
    existing.jobIds.push(job.jobId);
    existing.totalPennies += job.feeAmountPennies;
    byContractor.set(job.contractorId, existing);
  }

  return [...byContractor.entries()]
    .map(([contractorId, { jobIds, totalPennies }]) => ({
      contractorId,
      jobIds: [...jobIds].sort(),
      totalPennies,
    }))
    .sort((a, b) => (a.contractorId < b.contractorId ? -1 : 1));
};

// Dunning: how many times to re-attempt a failed collection and how long to
// wait between attempts. `maxAttempts` counts total tries including the first,
// so 4 = one initial charge plus three retries.
export type DunningPolicy = {
  maxAttempts: number;
  retryIntervalDays: number;
};

export const DEFAULT_DUNNING_POLICY: DunningPolicy = {
  maxAttempts: 4,
  retryIntervalDays: 3,
};

// A collection currently in the `failed` state, with how many charge attempts
// it has already had and when the last one ran.
export type FailedCollection = {
  attempts: number;
  lastAttemptAt: string;
};

export type DunningDecision = {
  // retry: charge again now. wait: not enough time has passed since the last
  // attempt. give_up: exhausted the retry budget — stop and pause billing.
  action: "retry" | "wait" | "give_up";
  // The fee_collection_status the trade should be moved to as a result.
  // 'past_due' while we keep trying; 'paused' once we give up.
  contractorStatus: "past_due" | "paused";
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Decides the next dunning move for a failed collection. Give up once the retry
// budget is spent (pausing billing so a human can intervene); otherwise retry
// only when at least `retryIntervalDays` have elapsed since the last attempt.
export const planDunningAction = (
  collection: FailedCollection,
  now: Date,
  policy: DunningPolicy = DEFAULT_DUNNING_POLICY,
): DunningDecision => {
  if (collection.attempts >= policy.maxAttempts) {
    return { action: "give_up", contractorStatus: "paused" };
  }

  const elapsedMs = now.getTime() - new Date(collection.lastAttemptAt).getTime();
  if (elapsedMs >= policy.retryIntervalDays * MS_PER_DAY) {
    return { action: "retry", contractorStatus: "past_due" };
  }

  return { action: "wait", contractorStatus: "past_due" };
};
