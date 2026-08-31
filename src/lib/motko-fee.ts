// The motko fee — marginal percentage ladder with floor, no cap.
//
// motko only earns when a job is *paid*. The first `FREE_JOB_ALLOWANCE` paid
// jobs per trade are free (fee waived). After that a marginal percentage ladder
// applies to the net job value:
//   - First £5,000: 0.3% (30 basis points)
//   - Next £5,000 (£5,001–£10,000): 0.2% (20 basis points)
//   - Above £10,000: 0.15% (15 basis points)
//   - Floor: £2.00 (200p)
//   - No cap
//
// All amounts are in pennies (integers). The fee is taken at source: Stripe
// deducts it from the customer's payment as an application_fee_amount on the
// destination charge, so the trade receives the job value minus this fee (see
// stripe-payments.ts). Jobs settled that way are recorded 'collected'
// immediately. Only legacy jobs and hand-marked payments still 'accrue'.

export const FREE_JOB_ALLOWANCE = 5;

// Fee ladder configuration
export const FEE_FLOOR_PENNIES = 200; // £2.00 minimum fee
export const FEE_TIER_1_THRESHOLD_PENNIES = 500_000; // £5,000
export const FEE_TIER_2_THRESHOLD_PENNIES = 1_000_000; // £10,000
export const FEE_TIER_1_RATE_BPS = 30; // 0.3% = 30 basis points
export const FEE_TIER_2_RATE_BPS = 20; // 0.2% = 20 basis points
export const FEE_TIER_3_RATE_BPS = 15; // 0.15% = 15 basis points

// Kept for backward compatibility with existing tests
export const FEE_STANDARD_PENNIES = 200; // £2

// The fee for a single paid job. `freeJobsRemaining` is the trade's cached free
// allowance at the moment of payment; when > 0 the job is free and consumes one
// credit (the caller records the `job_consumed` ledger event). The fee is
// computed via a marginal ladder on the net job value.
export const motkoFeePennies = (
  jobValuePennies: number,
  freeJobsRemaining: number,
): number => {
  if (freeJobsRemaining > 0) return 0;

  // Handle zero or negative values
  if (jobValuePennies <= 0) return FEE_FLOOR_PENNIES;

  let fee = 0;

  // First tier: 0-£5,000 at 0.3%
  if (jobValuePennies <= FEE_TIER_1_THRESHOLD_PENNIES) {
    fee = (jobValuePennies * FEE_TIER_1_RATE_BPS) / 10_000;
  } else {
    fee = (FEE_TIER_1_THRESHOLD_PENNIES * FEE_TIER_1_RATE_BPS) / 10_000;

    // Second tier: £5,001-£10,000 at 0.2%
    if (jobValuePennies <= FEE_TIER_2_THRESHOLD_PENNIES) {
      const tier2Amount = jobValuePennies - FEE_TIER_1_THRESHOLD_PENNIES;
      fee += (tier2Amount * FEE_TIER_2_RATE_BPS) / 10_000;
    } else {
      const tier2Amount = FEE_TIER_2_THRESHOLD_PENNIES - FEE_TIER_1_THRESHOLD_PENNIES;
      fee += (tier2Amount * FEE_TIER_2_RATE_BPS) / 10_000;

      // Third tier: above £10,000 at 0.15%
      const tier3Amount = jobValuePennies - FEE_TIER_2_THRESHOLD_PENNIES;
      fee += (tier3Amount * FEE_TIER_3_RATE_BPS) / 10_000;
    }
  }

  // Round half up to nearest penny
  fee = Math.round(fee);

  // Apply floor
  return Math.max(fee, FEE_FLOOR_PENNIES);
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
