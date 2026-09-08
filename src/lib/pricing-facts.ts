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
// SUB-3, 7 Sep 2026: the marketing copy is published from the live website
// rather than from `site/` in this repo, so there is no longer a published page
// here for a test to hold in step. `tests/regression/pricing-copy.test.ts` now
// covers the in-app half only — `markPaidFeeLine` against `motkoFeePennies`.
// Keeping the marketing wording true to the schedule is a human step outside
// this repository. This module still exists to make that step easy: every
// figure below is derived, so the correct numbers can be read off rather than
// worked out by hand.

import {
  FEE_CAP_BINDS_AT_PENNIES,
  FEE_CAP_PENNIES,
  FEE_FIXED_TENTHS,
  FEE_RATE_BPS,
  motkoFeePennies,
} from "@/lib/motko-fee";
import { SUBSCRIPTION_PRICE_PENNIES } from "@/lib/subscription";

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
  10_000, // £100
  25_000, // £250
  50_000, // £500
  96_000, // £960 — where the cap starts biting
  200_000, // £2,000
  500_000, // £5,000
  2_500_000, // £25,000 — flat at the cap, so a big job's fee is stated not implied
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
 * The service fee as published, in the words the spec mandates.
 *
 * SUB-3 replaced the marginal ladder with a single rate plus a fixed component,
 * capped — so there are no bands left to explain, and the "marginal" trap the
 * old wording existed to defuse is gone with them.
 *
 * TWO THINGS THE SPEC IS EXPLICIT ABOUT.
 *
 * The fixed component is described as 40p while 39.6p is charged. That is
 * deliberate: it is derived here by rounding the charged constant rather than
 * typed, so it cannot drift, and it errs in the trade's favour — every fee is
 * fractionally below what the headline implies, never above. The worked table
 * remains exact, because its rows call `motkoFeePennies`.
 *
 * And never describe it as "Stripe's fee plus 65%". The 1.65 multiple is how
 * the schedule was derived, not a runtime factor: motko's cost drops when it
 * registers for VAT and the charged fee will not follow. A trade can check the
 * claim, and it would stop being true.
 */
export const FEE_RATE = bpsToPercent(FEE_RATE_BPS);
export const FEE_FIXED = poundsFromPennies(Math.round(FEE_FIXED_TENTHS / 10));
export const FEE_CAP = poundsFromPennies(FEE_CAP_PENNIES);

/**
 * Where the cap starts biting, published so the table's flat tail is explicable.
 *
 * Derived rather than stated: it is the job value at which rate + fixed reaches
 * the cap, and it moves if any of the three constants do.
 */
export const FEE_CAP_FROM = wholePoundsFromPennies(FEE_CAP_BINDS_AT_PENNIES);

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

/**
 * The fixed component EXACTLY as charged — "39.6p", not the rounded "40p".
 *
 * `FEE_FIXED` rounds up so the headline is never below the real fee, which is
 * right for marketing. It is the wrong trade in the contractor terms, which is
 * the document a trade quotes back at you in a dispute: "you said 40p" is a
 * worse conversation than an ugly number, and the difference is only ugly.
 * Decided 7 Sep 2026 (Jacob) — exact in the terms, rounded on the site.
 */
export const FEE_FIXED_EXACT = `${FEE_FIXED_TENTHS / 10}p`;

/**
 * The fee schedule as the contractor terms state it.
 *
 * Rendered by `src/app/terms/page.tsx` rather than typed into it, for the same
 * reason that page already renders `REVERSAL_CLAUSE` from a constant: the
 * document and the code that charges cannot state different things if there is
 * only one of them. That discipline was applied to the reversal CLAUSE and not
 * to the PRICE, which is how the page came to publish the retired marginal
 * ladder — every clause of it false — for the whole life of the ladder's
 * replacement, with no test anywhere holding it to `motkoFeePennies`.
 *
 * Every figure is derived. Nothing here is typed twice.
 */
export const FEE_SCHEDULE_SENTENCE =
  `The Motko transaction fee is ${FEE_RATE} of the job plus ${FEE_FIXED_EXACT}, ` +
  `rounded to the nearest penny, and never more than ${FEE_CAP}. The cap is ` +
  `reached on a job of ${FEE_CAP_FROM}, so on anything larger the fee stays at ` +
  `${FEE_CAP}. There is no minimum and no banding — one rate applies to the ` +
  `whole job.`;

/**
 * The subscription, in the terms' words.
 *
 * Derived from `SUBSCRIPTION_PRICE_PENNIES` for the same reason as everything
 * else here. Worth noting why it needed writing at all: SUB-1 shipped the
 * charge and the terms section titled "What Motko charges" did not mention it
 * once. A fee stated wrongly is a defect; a charge with no term behind it at
 * all is the harder position to defend, and it was the latter.
 *
 * The trigger is deliberately "after your three free jobs" rather than a date,
 * because that is what `shouldEndTrial` reads — the allowance being exhausted,
 * not a clock.
 */
export const SUBSCRIPTION_SENTENCE =
  `Motko costs ${poundsFromPennies(SUBSCRIPTION_PRICE_PENNIES)} a month. Your ` +
  `first three jobs are free and there is nothing to pay until you have taken ` +
  `them; after that the subscription starts and renews monthly until you ` +
  `cancel. The transaction fee is charged separately, per payment.`;

/**
 * What cancelling does, as SUB-6 (#666, merged 7 Sep) actually implements it.
 *
 * `cancel_at_period_end: true` on the Stripe subscription rather than a delete,
 * so the distinction the sentence draws — renewal stops, access does not — is
 * the one the code makes, and `isCancelling` still grants access where
 * `isCanceled` does not.
 */
export const CANCELLATION_SENTENCE =
  "Cancelling stops the next renewal. Your account stays fully usable until " +
  "the end of the month you have paid for, and your quotes, contracts and " +
  "invoices remain accessible afterwards.";
