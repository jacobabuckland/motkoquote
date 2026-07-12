import { describe, expect, it } from "vitest";
import type { LineItem } from "@/lib/schemas/job";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";

const item = (overrides: Partial<LineItem> = {}): LineItem => ({
  description: "Labour",
  category: "labour",
  quantity: 2,
  unit: "day",
  unit_price: 150,
  multiplier: 1,
  assumed: false,
  ...overrides,
});

describe("lineItemTotal", () => {
  it("multiplies quantity by unit price with no multiplier adjustment", () => {
    expect(lineItemTotal(item())).toBe(300);
  });

  it("applies a multiplier on top of quantity * unit_price", () => {
    expect(lineItemTotal(item({ multiplier: 1.5 }))).toBe(450);
  });

  it("rounds to 2 decimal places", () => {
    expect(lineItemTotal(item({ quantity: 3, unit_price: 33.33, multiplier: 1.1 }))).toBe(109.99);
  });

  it("treats a missing multiplier as 1 for legacy line items loaded without zod parsing", () => {
    const legacyItem = item();
    // @ts-expect-error simulating a pre-existing DB record read via a type
    // cast (line_items_json as LineItem[]) rather than zod parsing.
    delete legacyItem.multiplier;
    expect(lineItemTotal(legacyItem)).toBe(300);
  });
});

describe("computeQuoteTotals", () => {
  it("sums multiplier-adjusted line items and applies VAT when registered", () => {
    const items = [item({ multiplier: 1.5 }), item({ quantity: 1, unit_price: 50 })];
    const totals = computeQuoteTotals(items, true);
    expect(totals.subtotal).toBe(500);
    expect(totals.vat).toBe(100);
    expect(totals.total).toBe(600);
  });

  it("skips VAT when not registered", () => {
    const totals = computeQuoteTotals([item({ multiplier: 2 })], false);
    expect(totals.subtotal).toBe(600);
    expect(totals.vat).toBe(0);
    expect(totals.total).toBe(600);
  });
});
