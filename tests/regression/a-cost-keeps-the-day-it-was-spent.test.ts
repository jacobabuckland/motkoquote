/**
 * "I paid him in cash yesterday" is a date, and it was thrown away.
 *
 * Voice cost capture had no field for when the money was spent. `incurredOn`
 * was the client's clock and nothing else, so a £160 helper paid on the 15th
 * saved as the 16th (16 Sep). A cost on the wrong day can land in the wrong VAT
 * quarter, which is the kind of error nobody notices until a return is filed.
 *
 * The model now reports the WORDS and `resolveSpokenDate` decides what they
 * mean — the same division of labour the amount and the VAT basis already have.
 * Nothing trusts a date the model computed.
 *
 * The resolver is deliberately small: the handful of phrases a trade uses about
 * a receipt in their pocket, and `null` for everything else so the caller falls
 * back to today. A wrong date is worse than today's date.
 */

import { describe, expect, it } from "vitest";
import { resolveSpokenDate } from "@/lib/voice/spoken-date";
import { buildDraftFromToolArgs } from "@/lib/voice/draft-cost";
import type { JobSummary } from "@/lib/match-job";

// A Wednesday, which is what the live run was.
const TODAY = "2026-09-16";

describe("the phrases a trade actually uses", () => {
  it.each([
    ["yesterday", "2026-09-15"],
    ["Yesterday afternoon", "2026-09-15"],
    ["today", "2026-09-16"],
    ["this morning", "2026-09-16"],
    ["just now", "2026-09-16"],
    ["the day before yesterday", "2026-09-14"],
  ])("%j → %s", (words, expected) => {
    expect(resolveSpokenDate(words, TODAY)).toBe(expected);
  });

  it.each([
    ["last Friday", "2026-09-11"],
    ["on Monday", "2026-09-14"],
    ["Tuesday", "2026-09-15"],
    // Said ON a Wednesday, "Wednesday" is today rather than a week ago.
    ["Wednesday", "2026-09-16"],
  ])("%j → %s", (words, expected) => {
    expect(resolveSpokenDate(words, TODAY)).toBe(expected);
  });

  it("never resolves to a day that has not happened", () => {
    for (const day of ["thursday", "friday", "saturday", "sunday", "monday", "tuesday"]) {
      const resolved = resolveSpokenDate(day, TODAY);
      expect(resolved, day).not.toBeNull();
      expect(resolved! <= TODAY, `${day} resolved to ${resolved}, which is in the future`).toBe(true);
    }
  });
});

describe("words it is not sure of", () => {
  it.each([
    ["a couple of weeks back"],
    ["some time last month"],
    ["the other day"],
    [""],
    [null],
  ])("%j answers null, so the caller falls back to today", (words) => {
    expect(resolveSpokenDate(words, TODAY)).toBeNull();
  });
});

describe("the cost draft", () => {
  const JOBS: JobSummary[] = [
    { id: "job_1", customer_name: "Henderson", created_at: "2026-09-01T00:00:00Z" },
  ];

  const draftWith = (incurred_on_words: string | null) => {
    const outcome = buildDraftFromToolArgs(
      {
        amount_words: "one hundred and sixty pounds",
        amount_basis: "gross",
        vat_treatment: "zero",
        paid: true,
        incurred_on_words,
        counterparty_name: "QA AutoHelper",
        category: "labour",
        job_spoken_words: "the Henderson job",
        description: "Helper's labour",
      } as never,
      TODAY,
      JOBS,
    );
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.draft;
  };

  it("dates run 19's helper to the day he was actually paid", () => {
    expect(draftWith("yesterday").incurredOn).toBe("2026-09-15");
  });

  it("falls back to today when no day was named", () => {
    expect(draftWith(null).incurredOn).toBe(TODAY);
  });

  it("keeps the paid state alongside it", () => {
    // Both facts were spoken in one breath and both were lost. The date is the
    // half that had nowhere to go at all.
    const draft = draftWith("yesterday");

    expect(draft.paid).toBe(true);
    expect(draft.vatTreatment).toBe("zero");
    expect(draft.amountNet).toBe(16000);
  });
});
