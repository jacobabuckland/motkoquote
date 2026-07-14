import { describe, expect, it } from "vitest";
import type { LineItem } from "@/lib/schemas/job";
import { applyRateCards, findMatchingRateCard, type RateCard } from "@/lib/rate-card-matching";

const rateCard = (overrides: Partial<RateCard> = {}): RateCard => ({
  work_type: "skim coat plastering",
  unit: "m2",
  rate_per_unit: 12.5,
  complexity_notes: null,
  ...overrides,
});

const lineItem = (overrides: Partial<LineItem> = {}): LineItem => ({
  description: "Plastering – skim coat, living room",
  category: "labour",
  quantity: 20,
  unit: "day",
  unit_price: 999,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: true,
  assumption_note: "guessed",
  ...overrides,
});

describe("findMatchingRateCard", () => {
  it("matches when every rate-card word appears in the description", () => {
    expect(findMatchingRateCard(lineItem().description, [rateCard()])).toEqual(rateCard());
  });

  it("does not match when a rate-card word is missing from the description", () => {
    expect(findMatchingRateCard("Rewiring – kitchen circuit", [rateCard()])).toBeUndefined();
  });

  it("is case-insensitive and punctuation-insensitive", () => {
    const card = rateCard({ work_type: "Skim-Coat Plastering!" });
    expect(findMatchingRateCard(lineItem().description, [card])).toEqual(card);
  });
});

describe("applyRateCards", () => {
  it("overrides unit/unit_price and clears assumed on a matching line item", () => {
    const [result] = applyRateCards([lineItem()], [rateCard()]);
    expect(result).toMatchObject({
      unit: "m2",
      unit_price: 12.5,
      assumed: false,
      assumption_note: undefined,
    });
  });

  it("leaves non-matching line items untouched", () => {
    const original = lineItem({ description: "Travel to site" });
    const [result] = applyRateCards([original], [rateCard()]);
    expect(result).toEqual(original);
  });
});
