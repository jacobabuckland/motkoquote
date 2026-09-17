/**
 * "Sixty pounds including VAT" is a cost. It was a loop.
 *
 * `draft_cost` is told to report the contractor's WORDS, so `amount_words`
 * arrives as they said it. Every VAT-qualified phrase parsed to null:
 *
 *     "£60 including VAT"  ->  null
 *     "£36 total"          ->  null
 *     "£50 plus VAT"       ->  null
 *
 * A null amount refuses the capture and sends the assistant back to ask. It
 * asks, the contractor repeats the same true sentence, and it refuses again.
 * Runs 106 and 109 of the 17 Sep tranche ended after four and five follow-ups
 * with NO cost saved — not a wrong figure, no record at all, on two of the
 * twelve cost scenarios.
 *
 * The qualifier is now removed before parsing and READ rather than discarded,
 * because "including VAT" is the contractor telling us the basis and it is
 * better evidence than the nothing we have when the model omits amount_basis.
 */

import { describe, expect, it } from "vitest";
import { buildDraftFromToolArgs, readAmountPhrase } from "@/lib/voice/draft-cost";
import type { JobSummary } from "@/lib/match-job";

const JOBS = [{ id: "job_1", customer_name: "QA Customer" }] as unknown as JobSummary[];
const TODAY = "2026-09-17";

const draft = (amount_words: string, extra: Record<string, unknown> = {}) =>
  buildDraftFromToolArgs(
    {
      amount_words,
      job_spoken_words: "QA Customer",
      description: "Delivery",
      category: "materials",
      vat_treatment: "standard",
      ...extra,
    },
    TODAY,
    JOBS,
  );

describe("reading the amount out of the words", () => {
  it("finds the figure behind a VAT qualifier", () => {
    expect(readAmountPhrase("£60 including VAT").pence).toBe(6000);
    expect(readAmountPhrase("£36 inc VAT").pence).toBe(3600);
    expect(readAmountPhrase("sixty pounds including VAT").pence).toBe(6000);
    expect(readAmountPhrase("£50 plus VAT").pence).toBe(5000);
  });

  it("takes the basis from the words when they name VAT outright", () => {
    expect(readAmountPhrase("£60 including VAT").basis).toBe("gross");
    expect(readAmountPhrase("£50 plus VAT").basis).toBe("net");
    expect(readAmountPhrase("£37.50 before VAT").basis).toBe("net");
  });

  it("takes no basis from a bare totaliser", () => {
    // "Total" does not mean "including VAT" in every trade's mouth, and
    // guessing would move the net figure on a real cost record.
    expect(readAmountPhrase("£36 total")).toEqual({ pence: 3600, basis: null });
    expect(readAmountPhrase("£12 in total").basis).toBeNull();
  });

  it("leaves a plain amount exactly as it was", () => {
    expect(readAmountPhrase("£60")).toEqual({ pence: 6000, basis: null });
    expect(readAmountPhrase("£45.50")).toEqual({ pence: 4550, basis: null });
  });
});

describe("the two runs that saved nothing", () => {
  it("captures run 109's £36 delivery as £30 net and £6 VAT", () => {
    const result = draft("£36 including VAT", { paid: true });

    expect(result.ok, "five follow-ups and no record").toBe(true);
    if (!result.ok) return;
    expect(result.draft.amountPence).toBe(3600);
    expect(result.draft.amountNet).toBe(3000);
    expect(result.draft.vatAmount).toBe(600);
  });

  it("captures run 106's £60 as £50 net and £10 VAT", () => {
    const result = draft("£60 including VAT");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.amountNet).toBe(5000);
    expect(result.draft.vatAmount).toBe(1000);
  });
});

describe("what the words may not override", () => {
  it("keeps the basis the model reported", () => {
    // The model's own field is the authority; the words only fill a gap. A
    // disagreement between them must stay visible rather than be resolved here.
    const result = draft("£60 including VAT", { amount_basis: "net" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.amountBasis).toBe("net");
  });

  it("still refuses to split an amount whose basis nobody stated", () => {
    const result = draft("£36 total");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.amountBasis).toBe("unknown");
    expect(result.draft.amountNet, "asking is the decided behaviour here").toBeNull();
    expect(result.draft.vatAmount).toBeNull();
  });
});
