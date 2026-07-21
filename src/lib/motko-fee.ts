// The motko fee — deterministic, flat, capped. Never a percentage.
//
// motko only earns when a job is *paid*. The first `FREE_JOB_ALLOWANCE` paid
// jobs per trade are free (fee waived). After that a flat fee accrues per paid
// job: £2 up to £1,000, £4 above — a hard cap that never climbs with job value.
//
// All amounts are in pennies (integers). The fee is *accrued*, not deducted
// from the customer's payment (that goes to the trade in full via pay-by-bank);
// it is billed separately and collected in a batch.

export const FREE_JOB_ALLOWANCE = 5;
export const FEE_STANDARD_PENNIES = 200; // £2
export const FEE_LARGE_PENNIES = 400; // £4 — hard cap
export const FEE_BAND_THRESHOLD_PENNIES = 100_000; // £1,000

// The fee for a single paid job. `freeJobsRemaining` is the trade's cached free
// allowance at the moment of payment; when > 0 the job is free and consumes one
// credit (the caller records the `job_consumed` ledger event). The band is
// decided on the job's invoiced total.
export const motkoFeePennies = (
  jobValuePennies: number,
  freeJobsRemaining: number,
): number => {
  if (freeJobsRemaining > 0) return 0;
  if (jobValuePennies <= FEE_BAND_THRESHOLD_PENNIES) return FEE_STANDARD_PENNIES;
  return FEE_LARGE_PENNIES;
};
