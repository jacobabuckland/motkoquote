// Pure summariser for the trade's fee statement (Settings). The per-collection
// net/VAT split is stored on fee_collections, so the only arithmetic is rolling
// up the still-accrued jobs into a single "to be collected next" total. Kept
// pure and I/O-free so it's unit tested without a database; the section
// component gathers the rows and renders what this returns.

export type AccruedFeeJob = {
  feeAmountPennies: number;
  netPennies: number;
  vatPennies: number;
};

export type AccruedFeeTotals = {
  grossPennies: number;
  netPennies: number;
  vatPennies: number;
  jobCount: number;
};

// Sums the accrued (not-yet-collected) fees into gross/net/VAT + a job count.
// The fee is VAT-inclusive, so grossPennies always equals netPennies +
// vatPennies (each job's split does, so the sum does too).
export const summariseAccruedFees = (jobs: AccruedFeeJob[]): AccruedFeeTotals =>
  jobs.reduce<AccruedFeeTotals>(
    (acc, job) => ({
      grossPennies: acc.grossPennies + job.feeAmountPennies,
      netPennies: acc.netPennies + job.netPennies,
      vatPennies: acc.vatPennies + job.vatPennies,
      jobCount: acc.jobCount + 1,
    }),
    { grossPennies: 0, netPennies: 0, vatPennies: 0, jobCount: 0 },
  );
