// The motko fee — a percentage plus a fixed component, capped.
//
// motko only earns when a job is *paid*. The first `FREE_JOB_ALLOWANCE` paid
// jobs per trade are free (fee waived). After that, per settlement:
//
//   0.99% + 39.6p, capped at £9.90
//
// SUB-3, from spec §3.2. It replaces the marginal ladder (0.3% / 0.2% / 0.15%,
// £2 floor, no cap) that shipped as FEE-1…FEE-9, which lost money on every job
// between roughly £293 and £2,000 — a band containing the median job.
//
// WHERE THE NUMBERS COME FROM. Stripe's Pay by Bank fee is 0.5% + 20p capped at
// £5. motko is not yet VAT-registered and cannot reclaim the VAT on it, so the
// real cost today is 0.6% + 24p capped at £6.00. The schedule above is exactly
// 1.65× that, cap and knee included — which is why margin is always 0.65 × cost
// and no job can lose money by construction. Free jobs are the only exception
// and are deliberate.
//
// 1.65 IS THE DERIVATION, NOT A RUNTIME FACTOR. When motko registers for VAT
// its cost drops back to 0.5% + 20p capped at £5; the charged fee does NOT
// change and the extra margin is retained. Do not reintroduce the multiplier as
// code — these are fixed constants that happen to have been derived that way.
//
// And never describe it to a trade as "Stripe's fee plus 65%": that stops being
// true the day motko registers, and a trade can check it. Describe the rate.
//
// All amounts are in pennies (integers). The fee is taken at source: Stripe
// deducts it from the customer's payment as an application_fee_amount on the
// destination charge, so the trade receives the job value minus this fee (see
// stripe-payments.ts). Jobs settled that way are recorded 'collected'
// immediately. Only legacy jobs and hand-marked payments still 'accrue'.

export const FREE_JOB_ALLOWANCE = 3;

// The schedule. The fixed component is 39.6p — not a whole number of pennies —
// so it is held in TENTHS of a penny and the arithmetic is done at that scale,
// rounding only once at the end. Rounding earlier makes every fee a penny light:
// £100 is 138.6p, which is £1.39, and the spec's own table says so.
export const FEE_RATE_BPS = 99; // 0.99% = 99 basis points
export const FEE_FIXED_TENTHS = 396; // 39.6p, in tenths of a penny
export const FEE_CAP_PENNIES = 990; // £9.90

// The cap binds at exactly £960 — as does Stripe's own £6.00 cap, since the
// whole function is 1.65× theirs. Above it every job pays £9.90 and costs £6.00.
export const FEE_CAP_BINDS_AT_PENNIES = 96_000;

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
// credit (the caller records the `job_consumed` ledger event).
//
// PER SETTLEMENT, IN FULL. The percentage, the fixed component and the cap all
// apply per charge, mirroring Stripe, whose own fee is per payment. A staged job
// pays this once per stage; nothing is apportioned across stages.
export const motkoFeePennies = (
  jobValuePennies: number,
  freeJobsRemaining: number,
): number => {
  if (freeJobsRemaining > 0) return 0;

  // A non-positive job value has no percentage component. Returning the fixed
  // component alone would bill 40p against nothing, so this is zero — and the
  // swallow guard below would skip it anyway.
  if (jobValuePennies <= 0) return 0;

  // Tenths of a penny throughout: (value × 99 / 10_000) × 10 is value × 99 / 1000.
  const rateTenths = (jobValuePennies * FEE_RATE_BPS) / 1_000;
  const cappedTenths = Math.min(rateTenths + FEE_FIXED_TENTHS, FEE_CAP_PENNIES * 10);

  // Round half up, once, at the end.
  return Math.round(cappedTenths / 10);
};

/**
 * Whether taking this fee would consume the payment it is taken from.
 *
 * Stripe does NOT reject an application fee larger than the charge — it caps
 * what it collects at the captured amount, so a fee at or above the payment
 * would hand motko everything and the trade nothing, silently.
 *
 * ONE predicate, called by the Stripe call site and by settlement. They had the
 * comparison written out separately until SUB-3, which is how the free-job
 * waiver came to disagree between the two paths — `stripe-payments.ts` waived
 * £2 while settlement waived in full, so a "free" job over £666.67 was charged
 * the difference at source while the ledger recorded it free. Latent rather than
 * realised (every free job settled so far sat under that threshold), but it is
 * the same drift FEE-9 exists to prevent, and duplicating this comparison is how
 * it would come back.
 */
export const feeWouldSwallowPayment = (
  feePennies: number,
  jobValuePennies: number,
): boolean => feePennies >= jobValuePennies;

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
