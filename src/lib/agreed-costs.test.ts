import { describe, expect, it } from "vitest";
import type { LineItem } from "@/lib/schemas/job";
import { applyAgreedDayRate, applyAgreedFixedPrice } from "@/lib/agreed-costs";

const item = (overrides: Partial<LineItem> = {}): LineItem => ({
  description: "Labour",
  category: "labour",
  quantity: 2,
  unit: "day",
  unit_price: 150,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...overrides,
});

describe("applyAgreedDayRate", () => {
  it("overrides non-overtime labour line unit_price with the agreed day rate", () => {
    const result = applyAgreedDayRate([item({ unit_price: 200 })], 175);
    expect(result[0]?.unit_price).toBe(175);
  });

  it("leaves overtime labour lines untouched", () => {
    const result = applyAgreedDayRate([item({ overtime: true, unit_price: 300 })], 175);
    expect(result[0]?.unit_price).toBe(300);
  });

  it("leaves non-labour lines untouched", () => {
    const result = applyAgreedDayRate(
      [item({ category: "materials", unit_price: 50 })],
      175,
    );
    expect(result[0]?.unit_price).toBe(50);
  });

  it("is a no-op when no day rate was agreed", () => {
    const items = [item({ unit_price: 200 })];
    expect(applyAgreedDayRate(items, null)).toEqual(items);
    expect(applyAgreedDayRate(items, undefined)).toEqual(items);
  });
});

describe("applyAgreedFixedPrice", () => {
  it("scales every line item proportionally so the subtotal matches the agreed fixed price exactly", () => {
    const items = [
      item({ description: "Labour", quantity: 2, unit_price: 150 }), // 300
      item({ description: "Materials", category: "materials", quantity: 1, unit_price: 100 }), // 100
    ];
    // Original subtotal: 400. Agreed fixed price: 500 → factor 1.25.
    const result = applyAgreedFixedPrice(items, 500);
    expect(result[0]?.unit_price).toBe(187.5);
    expect(result[1]?.unit_price).toBe(125);

    const newSubtotal = result.reduce(
      (sum, i) => sum + i.quantity * i.unit_price * i.multiplier * i.people_count,
      0,
    );
    expect(newSubtotal).toBe(500);
  });

  it("scales down when the agreed price is below the drafted subtotal", () => {
    const items = [item({ quantity: 4, unit_price: 100 })]; // 400
    const result = applyAgreedFixedPrice(items, 300);
    expect(result[0]?.unit_price).toBe(75);
  });

  it("is a no-op when no fixed price was agreed", () => {
    const items = [item()];
    expect(applyAgreedFixedPrice(items, null)).toEqual(items);
    expect(applyAgreedFixedPrice(items, undefined)).toEqual(items);
  });

  it("never produces a negative unit_price", () => {
    const items = [item({ unit_price: 150 }), item({ description: "Materials", category: "materials", unit_price: 50 })];
    const result = applyAgreedFixedPrice(items, 10);
    for (const resultItem of result) {
      expect(resultItem.unit_price).toBeGreaterThanOrEqual(0);
    }
  });

  it("leaves line items unchanged when the current subtotal is zero", () => {
    const items = [item({ unit_price: 0 })];
    expect(applyAgreedFixedPrice(items, 500)).toEqual(items);
  });
});
