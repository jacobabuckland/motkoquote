import { describe, expect, it } from "vitest";
import type { LineItem } from "@/lib/schemas/job";
import { lineItemTotal } from "@/lib/quote-math";
import { applyLabourRates, type LabourRates } from "@/lib/labour-rates";

const rates = (overrides: Partial<LabourRates> = {}): LabourRates => ({
  day_rate: 200,
  overtime_rate: 300,
  team_members: [],
  ...overrides,
});

const labourItem = (overrides: Partial<LineItem> = {}): LineItem => ({
  description: "Labour – Plastering team",
  category: "labour",
  quantity: 2,
  unit: "day",
  // Whatever the LLM guessed — always discarded by applyLabourRates in
  // favour of the contractor's actual stored rate.
  unit_price: 999,
  multiplier: 1,
  people_count: 2,
  overtime: false,
  assumed: false,
  ...overrides,
});

describe("applyLabourRates", () => {
  it("computes 2 people x 2 days x £200/day = £800 from the contractor's day_rate, ignoring the LLM's unit_price", () => {
    const [result] = applyLabourRates([labourItem()], rates());
    expect(result?.unit_price).toBe(200);
    expect(lineItemTotal(result as LineItem)).toBe(800);
  });

  it("uses overtime_rate instead of day_rate when the line is flagged overtime", () => {
    const [result] = applyLabourRates(
      [labourItem({ overtime: true, people_count: 1, quantity: 1 })],
      rates(),
    );
    expect(result?.unit_price).toBe(300);
    expect(lineItemTotal(result as LineItem)).toBe(300);
  });

  it("rejects an LLM-suggested total in favour of the computed one when they mismatch", () => {
    // The LLM proposed unit_price:999 here — as if it had computed a much
    // higher total (999 * 2 people * 2 days = 3996) itself. The contractor's
    // real day_rate is £200, so the correct total is £800. Code must win.
    const llmSuggestedTotal = 999 * 2 * 2;
    const [result] = applyLabourRates([labourItem({ unit_price: 999 })], rates());
    const computedTotal = lineItemTotal(result as LineItem);

    expect(computedTotal).not.toBe(llmSuggestedTotal);
    expect(computedTotal).toBe(800);
  });

  it("prefers a named team member's own day_rate over the contractor default", () => {
    const [result] = applyLabourRates(
      [labourItem({ description: "Labour – Mark (Owner/Plasterer)", people_count: 1 })],
      rates({ team_members: [{ name: "Mark", day_rate: 250 }] }),
    );
    expect(result?.unit_price).toBe(250);
  });

  it("leaves non-labour line items untouched", () => {
    const materialItem: LineItem = {
      description: "Plaster boards",
      category: "materials",
      quantity: 10,
      unit: "sheet",
      unit_price: 12,
      multiplier: 1,
      people_count: 1,
      overtime: false,
      assumed: false,
    };
    const [result] = applyLabourRates([materialItem], rates());
    expect(result).toEqual(materialItem);
  });

  it("leaves the LLM's unit_price untouched when no day_rate or matching team member is known", () => {
    const [result] = applyLabourRates(
      [labourItem({ unit_price: 175 })],
      rates({ day_rate: null }),
    );
    expect(result?.unit_price).toBe(175);
  });
});
