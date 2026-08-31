// Pure summariser for the trade's fee statement (Settings). The per-collection
// net/VAT split is stored on fee_collections, so the only arithmetic is rolling
// up the still-accrued jobs into a single "to be collected next" total. Kept
// pure and I/O-free so it's unit tested without a database; the section
// component gathers the rows and renders what this returns.

import { countsAsFutureRevenue } from "@/lib/settlement-reversal";

export type AccruedFeeJob = {
  feeAmountPennies: number;
  netPennies: number;
  vatPennies: number;
  /**
   * The settlement state, when the row has one (FEE-10).
   *
   * Optional so every existing caller is unchanged: a row without one is an
   * ordinary live settlement, which is what they all were before reversal
   * existed. Reading it as "no state means live" is safe here and would not be
   * safe in the other direction — a reversed row silently counted as live is
   * the double-count this field exists to stop.
   */
  settlementState?: string | null;
};

export type AccruedFeeTotals = {
  grossPennies: number;
  netPennies: number;
  vatPennies: number;
  jobCount: number;
};

// Sums the accrued (not-yet-collected) fees into gross/net/VAT + a job count.
// grossPennies always equals netPennies + vatPennies (each job's split does, so
// the sum does too). motko is not VAT registered, so that split describes what
// was charged rather than adding to it.
//
// FEE-10: a REVERSED settlement is excluded. Its fee has already been taken and
// is kept — it is not money still to come — so counting it here would report the
// same fee twice, once as collected and once as expected. That is the
// double-count FEE-10's last acceptance criterion names, and it is a
// one-character mistake to make: the rows look identical apart from the state.
export const summariseAccruedFees = (jobs: AccruedFeeJob[]): AccruedFeeTotals =>
  jobs
    .filter((job) => countsAsFutureRevenue(job.settlementState ?? null))
    .reduce<AccruedFeeTotals>(
    (acc, job) => ({
      grossPennies: acc.grossPennies + job.feeAmountPennies,
      netPennies: acc.netPennies + job.netPennies,
      vatPennies: acc.vatPennies + job.vatPennies,
      jobCount: acc.jobCount + 1,
    }),
    { grossPennies: 0, netPennies: 0, vatPennies: 0, jobCount: 0 },
  );
