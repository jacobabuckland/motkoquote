import { describe, expect, it } from "vitest";
import { findMatchingRateCard, type RateCard } from "@/lib/rate-card-matching";

const rateCard = (overrides: Partial<RateCard> = {}): RateCard => ({
  work_type: "skim coat plastering",
  unit: "m2",
  rate_per_unit: 12.5,
  complexity_notes: null,
  ...overrides,
});

const description = "Plastering – skim coat, living room";

describe("findMatchingRateCard", () => {
  it("matches when every rate-card word appears in the description", () => {
    expect(findMatchingRateCard(description, [rateCard()])).toEqual(rateCard());
  });

  it("does not match when a rate-card word is missing from the description", () => {
    expect(findMatchingRateCard("Rewiring – kitchen circuit", [rateCard()])).toBeUndefined();
  });

  it("is case-insensitive and punctuation-insensitive", () => {
    const card = rateCard({ work_type: "Skim-Coat Plastering!" });
    expect(findMatchingRateCard(description, [card])).toEqual(card);
  });
});
