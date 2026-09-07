/**
 * The contractor terms must state the fee the app actually charges.
 *
 * This is the check whose absence let `src/app/terms/page.tsx` publish the
 * retired marginal ladder — "0.3% of the first £5,000, 0.2% of the next
 * £5,000, and 0.15% above £10,000, with a £2.00 minimum and no maximum" — with
 * every clause of it false. The page already rendered `REVERSAL_CLAUSE` from a
 * constant so the reversal RULES could not drift from `planSettlementReversal`.
 * The PRICE was typed into the JSX by hand and held to nothing at all, which is
 * the one number in the document a contractor would dispute.
 *
 * FEE-9 exists because /pricing published a price the code did not charge. The
 * same defect in the contractual document is worse, not equivalent, because
 * marketing copy is a claim and this is a term.
 *
 * So: the sentence is derived from `motkoFeePennies`, and this holds the
 * derivation to the function rather than to the words. It fails on a reprice
 * that does not carry the terms with it.
 */

import { describe, expect, it } from "vitest";

import {
  FEE_CAP_BINDS_AT_PENNIES,
  FEE_CAP_PENNIES,
  FEE_FIXED_TENTHS,
  motkoFeePennies,
} from "@/lib/motko-fee";
import {
  CANCELLATION_SENTENCE,
  FEE_FIXED_EXACT,
  FEE_SCHEDULE_SENTENCE,
  SUBSCRIPTION_SENTENCE,
  poundsFromPennies,
} from "@/lib/pricing-facts";
import { SUBSCRIPTION_PRICE_PENNIES } from "@/lib/subscription";

describe("the terms state the fee the app charges", () => {
  it("names the cap, and the cap is what the function returns above it", () => {
    expect(FEE_SCHEDULE_SENTENCE).toContain(poundsFromPennies(FEE_CAP_PENNIES));

    // Not merely that the number appears — that it is true. A job above the
    // knee pays exactly this, so "never more than" is a fact rather than a
    // claim about a constant.
    expect(motkoFeePennies(FEE_CAP_BINDS_AT_PENNIES * 10, 0)).toBe(FEE_CAP_PENNIES);
  });

  it("names the job value where the cap starts biting, and it does bite there", () => {
    expect(FEE_SCHEDULE_SENTENCE).toContain("£960");

    // The claim is that the cap is REACHED at this value — so one penny of job
    // below it must cost less, and the value itself must cost the cap exactly.
    expect(motkoFeePennies(FEE_CAP_BINDS_AT_PENNIES, 0)).toBe(FEE_CAP_PENNIES);
    expect(motkoFeePennies(FEE_CAP_BINDS_AT_PENNIES - 100, 0)).toBeLessThan(
      FEE_CAP_PENNIES,
    );
  });

  it("states the fixed component EXACTLY, not the rounded marketing figure", () => {
    // Decided 7 Sep 2026 (Jacob): exact in the terms, rounded on the site. The
    // terms are what a contractor quotes back in a dispute, and "you said 40p"
    // is a worse conversation than an ugly number.
    expect(FEE_FIXED_EXACT).toBe("39.6p");
    expect(FEE_SCHEDULE_SENTENCE).toContain("39.6p");
    expect(FEE_SCHEDULE_SENTENCE).not.toContain("40p");
    expect(FEE_FIXED_TENTHS).toBe(396);
  });

  it("states a rate that produces the fee the function produces below the cap", () => {
    expect(FEE_SCHEDULE_SENTENCE).toContain("0.99%");

    // Read the sentence as arithmetic and check it against the function, at a
    // value where the cap is not doing the work. This is what a contractor
    // would do to verify a charge, so it is what the test does.
    const jobPennies = 50_000; // £500
    const stated = Math.round((jobPennies * 0.99) / 100 + FEE_FIXED_TENTHS / 10);

    expect(stated).toBe(motkoFeePennies(jobPennies, 0));
  });

  it("does not describe the retired ladder in any form", () => {
    // Each of these was in the sentence this replaces, and each is now false.
    //
    // Not the bare word "band": the replacement says "no banding", and matching
    // a substring of the copy that DENIES the retired claim is the over-match
    // AGENTS.md warns about — it would fail precisely when the wording is right.
    // So the retired phrase is matched whole.
    for (const retired of [
      "0.3%",
      "0.2%",
      "0.15%",
      "£2.00 minimum",
      "no maximum",
      "falls inside its band",
    ]) {
      expect(FEE_SCHEDULE_SENTENCE).not.toContain(retired);
    }
  });

  it("calls it the transaction fee, not the service fee", () => {
    expect(FEE_SCHEDULE_SENTENCE).toContain("transaction fee");
    expect(FEE_SCHEDULE_SENTENCE.toLowerCase()).not.toContain("service fee");
  });
});

describe("the terms state the subscription the app charges", () => {
  it("names the real price", () => {
    expect(SUBSCRIPTION_SENTENCE).toContain(
      poundsFromPennies(SUBSCRIPTION_PRICE_PENNIES),
    );
  });

  it("says the transaction fee is separate, because both are charged", () => {
    // The section is titled "What Motko charges" and carried only one of the
    // two for the whole life of SUB-1. A reader must not take either sentence
    // for the complete answer.
    expect(SUBSCRIPTION_SENTENCE).toMatch(/charged separately/i);
  });
});

describe("the terms describe cancellation as SUB-6 implements it", () => {
  it("says renewal stops but access does not", () => {
    // `cancel_at_period_end: true` rather than a delete, so these are two
    // different things and the sentence has to keep them apart — `isCancelling`
    // grants access where `isCanceled` does not.
    expect(CANCELLATION_SENTENCE).toMatch(/stops the next renewal/i);
    expect(CANCELLATION_SENTENCE).toMatch(/stays fully usable/i);
  });

  it("promises the records survive, which is the question a trade asks", () => {
    expect(CANCELLATION_SENTENCE).toMatch(/quotes, contracts and invoices/i);
  });
});
