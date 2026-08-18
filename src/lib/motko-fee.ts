// The motko fee — deterministic, flat, capped. Never a percentage.
//
// motko only earns when a job is *paid*. The first `FREE_JOB_ALLOWANCE` paid
// jobs per trade are free (fee waived). After that a flat fee accrues per paid
// job: £2 up to £1,000, £4 above — a hard cap that never climbs with job value.
//
// All amounts are in pennies (integers). The fee is taken at source: Stripe
// deducts it from the customer's payment as an application_fee_amount on the
// destination charge, so the trade receives the job value minus this fee (see
// stripe-payments.ts). Jobs settled that way are recorded 'collected'
// immediately. Only legacy jobs and hand-marked payments still 'accrue'.

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

// UK standard-rate VAT, in basis points (20%). motko is VAT-registered, so the
// flat £2/£4 fee is VAT-*inclusive*: it already contains VAT. We never add VAT
// on top — the trade is charged exactly £2/£4 — but we record the net/VAT split
// so their statement (and, later, a VAT invoice) can show the breakdown.
export const VAT_RATE_BPS = 2000;

export type VatSplit = {
  grossPennies: number;
  netPennies: number;
  vatPennies: number;
};

// Splits a VAT-inclusive gross amount into net + VAT. Net is rounded to the
// nearest penny and VAT is taken as the remainder, so net + vat === gross
// exactly — the amount collected is never altered by the split, only described.
// £2.00 → net £1.67, VAT £0.33; £4.00 → net £3.33, VAT £0.67.
export const splitFeeVat = (
  grossPennies: number,
  vatRateBps: number = VAT_RATE_BPS,
): VatSplit => {
  const netPennies = Math.round((grossPennies * 10_000) / (10_000 + vatRateBps));
  return { grossPennies, netPennies, vatPennies: grossPennies - netPennies };
};
