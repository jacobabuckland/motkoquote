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

export const FREE_JOB_ALLOWANCE = 3;

// Fee ladder configuration
export const FEE_FLOOR_PENNIES = 200; // £2.00 minimum fee
export const FEE_TIER_1_THRESHOLD_PENNIES = 500_000; // £5,000
export const FEE_TIER_2_THRESHOLD_PENNIES = 1_000_000; // £10,000
export const FEE_TIER_1_RATE_BPS = 30; // 0.3% = 30 basis points
export const FEE_TIER_2_RATE_BPS = 20; // 0.2% = 20 basis points
export const FEE_TIER_3_RATE_BPS = 15; // 0.15% = 15 basis points

// Kept for backward compatibility with existing tests
export const FEE_STANDARD_PENNIES = 200; // £2

/**
 * How much of the service fee one free-job credit waives.
 *
 * FEE-11: unbounded. A credit waives the WHOLE service fee.
 *
 * FEE-2 set this to the base-band fee and charged the remainder, with the
 * ceiling read from configuration so it moved with the bands. FEE-6 removed the
 * bands, and the nearest structural equivalent left is the £2.00 floor — waiving
 * £2 of a £43 fee is not recognisably a free job, and "your first three jobs are
 * free" was not true while it held.
 *
 * The ceiling stays a named, finite-checkable value rather than being deleted,
 * because FEE-2's split machinery stays with it: full, waived and payable are
 * all still persisted. Payable is always zero under the current decision, but
 * the mechanism survives if a ceiling is ever reinstated and the stored split
 * stays honest either way.
 */
export const FREE_JOB_WAIVER_CEILING_PENNIES = Number.POSITIVE_INFINITY;

/**
 * The most free-job credits a contractor may hold at once.
 *
 * FEE-11, confirmed at 10 (Jacob, 1 Sep 2026). FEE-1 removed the cap on banked
 * credits in favour of unlimited stacking, on the reasoning that FEE-2's
 * base-band ceiling was the remaining control on leakage. This removes that
 * ceiling, so the cap replaces it as the bound — and it binds hardest on the
 * best-connected contractors, the ones who refer, who would otherwise waive the
 * most.
 *
 * A grant that would exceed it is truncated to it, never refused outright: the
 * referral still activates and the referrer still gets whatever room is left.
 * Balances already above the cap are not clawed back.
 */
export const MAX_BANKED_FREE_JOBS = 10;

/**
 * How a free-job credit divides one fee: what it waives, what is still payable.
 *
 * ONE function, called by both settlement and the copy that describes it. They
 * had two constants for this rule until FEE-11 — `paid-job-settlement.ts` capped
 * the waiver and `fee-copy.ts` named its own `FREE_JOB_WAIVER_CAP_PENNIES` — and
 * raising the ceiling in one would have left the app telling a contractor "you
 * pay the difference above £2.00" on a job settlement now waives in full. That
 * is the same drift FEE-9 exists to fix, reproduced inside the fix for it.
 *
 * The ceiling is unbounded today, so `payable` is always zero. The arithmetic
 * stays because the persisted split has to stay honest and because reinstating a
 * ceiling should be a config change.
 */
export const waiverSplit = (
  fullFeePennies: number,
): { waivedPennies: number; payablePennies: number } => {
  const waivedPennies = Math.min(fullFeePennies, FREE_JOB_WAIVER_CEILING_PENNIES);
  return { waivedPennies, payablePennies: fullFeePennies - waivedPennies };
};

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
