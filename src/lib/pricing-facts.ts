// The published pricing facts — one source for the app, the marketing site and
// the tests that keep them in step.
//
// FEE-9 exists because /pricing published "£2 a job. Never more than £10. Never
// a percentage." while the code charged a marginal percentage ladder with no
// cap. Three claims, all wrong, two of them the exact opposite of the model.
// The governing constraint from that ticket, inherited from FEE-3, is:
//
//   The site must never state a price the app does not display, and vice versa.
//
// A constant nobody can diverge from is the only version of that which survives
// contact with a third reprice. Every number below is DERIVED from
// `motko-fee.ts` rather than restated, and `feeTableRows` computes its fees by
// calling `motkoFeePennies` — so a published figure cannot drift from the
// function that charges it without the table changing too.
//
// The marketing site is static HTML and cannot import this module. That link is
// held by `tests/regression/pricing-copy.test.ts`, which reads the rendered
// TEXT of the page (not its markup) and checks every figure against these
// values.

import {
  FEE_FLOOR_PENNIES,
  FEE_TIER_1_RATE_BPS,
  FEE_TIER_1_THRESHOLD_PENNIES,
  FEE_TIER_2_RATE_BPS,
  FEE_TIER_2_THRESHOLD_PENNIES,
  FEE_TIER_3_RATE_BPS,
  motkoFeePennies,
} from "@/lib/motko-fee";

/** Basis points as a percentage string: 30 → "0.3%". */
export const bpsToPercent = (bps: number): string => `${bps / 100}%`;

/** Pennies as a plain pounds string, trailing ".00" kept: 2000 → "£20.00". */
export const poundsFromPennies = (pennies: number): string =>
  `£${(pennies / 100).toFixed(2)}`;

/** Pennies as whole pounds, for thresholds: 500_000 → "£5,000". */
export const wholePoundsFromPennies = (pennies: number): string =>
  `£${(pennies / 100).toLocaleString("en-GB")}`;

// There is deliberately NO processing pass-through here. FEE-7 would have
// charged Stripe's cost through to the contractor and was DROPPED on 31 Aug
// (#475), so motko absorbs it. An earlier draft of this file published a £5.00
// cap; publishing a charge nobody makes is the same defect as publishing a
// retired band, which is the whole reason this module exists.

/**
 * Whether motko is registered for VAT.
 *
 * `false`, and the reason this is a named constant rather than a sentence in a
 * template: /pricing described fees as "VAT-inclusive" for a week while motko
 * was not registered, so there was no VAT in them to be inclusive of. The claim
 * was not merely imprecise, it was inaccurate, and it was repeated in four
 * places because nothing tied them together.
 *
 * Note what does NOT change on registration: `splitFeeVat` still records a
 * net/VAT split against each settlement. That split is a stored description of
 * an amount, not an addition to it, and FEE-9 is explicitly copy-only —
 * "the calculation" is out of its scope.
 */
export const VAT_REGISTERED = false;

export interface FeeTableRow {
  jobValuePennies: number;
  serviceFeePennies: number;
  /** The service fee as a percentage of the job, for the "it falls" column. */
  effectiveRate: string;
}

/**
 * The worked table published on /pricing.
 *
 * FEE-9: "Include a worked table. This pricing falls as a proportion as jobs
 * get bigger, and a table shows that better than prose. It must extend high
 * enough that a large job's fee is visible rather than implied."
 *
 * So the rows straddle both breakpoints and run to £25,000 — a fee of £47.50
 * stated plainly, rather than a reader being left to infer that "no maximum"
 * means something alarming.
 *
 * The fees are COMPUTED, never typed. That is the ticket's acceptance criterion
 * verbatim: "Every number on /pricing matches what motkoFeePennies actually
 * returns for that job value. Verify against the function, not against this
 * ticket."
 */
export const FEE_TABLE_JOB_VALUES_PENNIES = [
  50_000, // £500 — under the floor, shows the £2 minimum biting
  100_000, // £1,000
  250_000, // £2,500
  500_000, // £5,000 — first breakpoint
  750_000, // £7,500
  1_000_000, // £10,000 — second breakpoint
  1_500_000, // £15,000
  2_500_000, // £25,000
] as const;

export const feeTableRows = (): FeeTableRow[] =>
  FEE_TABLE_JOB_VALUES_PENNIES.map((jobValuePennies) => {
    const serviceFeePennies = motkoFeePennies(jobValuePennies, 0);
    return {
      jobValuePennies,
      serviceFeePennies,
      effectiveRate: `${((serviceFeePennies / jobValuePennies) * 100).toFixed(2)}%`,
    };
  });

/**
 * The service-fee ladder, as published.
 *
 * Read off `motko-fee.ts` so the site cannot state a rate the function does not
 * apply. The bands are expressed the way a contractor reads them — "the first
 * £5,000", "the next £5,000" — because "marginal" is the property people get
 * wrong, and a contractor who thinks 0.15% applies to the whole of a £15,000
 * job expects £22.50 and is charged £32.50.
 */
export const FEE_LADDER = [
  {
    band: `The first ${wholePoundsFromPennies(FEE_TIER_1_THRESHOLD_PENNIES)}`,
    rate: bpsToPercent(FEE_TIER_1_RATE_BPS),
  },
  {
    band: `The next ${wholePoundsFromPennies(
      FEE_TIER_2_THRESHOLD_PENNIES - FEE_TIER_1_THRESHOLD_PENNIES,
    )} (up to ${wholePoundsFromPennies(FEE_TIER_2_THRESHOLD_PENNIES)})`,
    rate: bpsToPercent(FEE_TIER_2_RATE_BPS),
  },
  {
    band: `Everything above ${wholePoundsFromPennies(FEE_TIER_2_THRESHOLD_PENNIES)}`,
    rate: bpsToPercent(FEE_TIER_3_RATE_BPS),
  },
] as const;

export const FEE_MINIMUM = poundsFromPennies(FEE_FLOOR_PENNIES);

/**
 * The rule for a quote sent before the reprice and paid after it.
 *
 * Decided 31 Aug 2026 (Jacob): the fee in force on the PAYMENT date applies.
 * FEE-9's card already records "applies to all contractors immediately — no
 * grandfathering", and this is that rule carried through to the one case where
 * it is ambiguous. It is also what the code does: the fee is computed at
 * settlement from the job value, and nothing stores the fee that was in force
 * when the quote was sent.
 *
 * Published rather than left implicit, because the alternative reading is the
 * one a contractor would naturally assume.
 */
export const REPRICE_RULE =
  "The fee is worked out when your customer pays, not when you send the quote. " +
  "A quote you sent before a price change is charged at the price in force on " +
  "the day it is paid.";
