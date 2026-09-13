// The quote PDF showed a day rate five times the one actually charged.
//
// Reported 13 Sep, and confirmed present in the customer's own copy — the
// reviewer decoded the PDF for a live job and found `934.33` in it and
// `183.33` absent. The row read:
//
//     24 day @ £934.33 ............................ £4,400.00
//
// 24 × £934.33 is £22,423.92. The £4,400 is right: the crew breakdown under
// the line is three people × 8 days at £250 / £180 / £120, which is £550 a day
// across the crew and £4,400 over 8 days. The quantity is right too — 3 crew ×
// 8 days = 24 crew-days. Only the displayed rate is wrong, and the correct
// blended figure is £550 / 3 = £183.33.
//
// The cause is that a crew line has TWO price sources. `lineItemTotal` prices
// it from `people` and documents `unit_price` as "a denormalised cache" it
// ignores. The PDF rendered the total from the first and the rate from the
// second, side by side on one row.
//
// Nothing about the charge was ever wrong. What was damaged is the credibility
// of the document a customer keeps.
import { describe, expect, it } from "vitest";
import { displayedUnitRate, lineItemTotal } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Work",
  category: "labour",
  quantity: 1,
  unit: "job",
  unit_price: 100,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

// The reported line, verbatim: the crew that sums to £4,400 and the stale
// cache that was being shown instead of their blended rate.
const THE_REPORTED_LINE = line({
  description: "Plastering labour",
  quantity: 24,
  unit: "day",
  unit_price: 934.33,
  people: [
    { label: "Jacob", days: 8, day_rate: 250 },
    { label: "Crew 2", days: 8, day_rate: 180 },
    { label: "Crew 3", days: 8, day_rate: 120 },
  ],
});

describe("the reported line", () => {
  it("still charges exactly what it charged — this fix moves no money", () => {
    expect(lineItemTotal(THE_REPORTED_LINE)).toBe(4400);
  });

  it("no longer shows the cache the total ignores", () => {
    expect(displayedUnitRate(THE_REPORTED_LINE)).not.toBe(934.33);
  });

  it("shows the blended crew rate instead", () => {
    // £4,400 / 24 crew-days. The same job's sibling line already renders this
    // figure correctly today, which is what made the defect diagnosable.
    expect(displayedUnitRate(THE_REPORTED_LINE)).toBe(183.33);
  });

  it("reconciles with its own total, which is the whole point", () => {
    const rate = displayedUnitRate(THE_REPORTED_LINE);
    const implied = rate * THE_REPORTED_LINE.quantity;
    // Within a penny per unit of rounding — a blended rate cannot always divide
    // exactly, and the sibling line that renders correctly has the same
    // residue (30 × £183.33 = £5,499.90 against £5,500).
    expect(Math.abs(implied - lineItemTotal(THE_REPORTED_LINE))).toBeLessThan(
      THE_REPORTED_LINE.quantity * 0.01 + 0.001,
    );
  });
});

describe("lines that were already right are untouched", () => {
  it("leaves an ordinary priced line alone", () => {
    const materials = line({ category: "materials", quantity: 10, unit: "bag", unit_price: 12.5 });
    expect(displayedUnitRate(materials)).toBe(12.5);
  });

  it("leaves a labour line with no crew breakdown alone", () => {
    const labour = line({ quantity: 3, unit: "day", unit_price: 250 });
    expect(displayedUnitRate(labour)).toBe(250);
  });

  it("leaves a line with an empty crew list alone", () => {
    const empty = line({ quantity: 2, unit: "day", unit_price: 300, people: [] });
    expect(displayedUnitRate(empty)).toBe(300);
  });

  it("does not divide by zero on a zero-quantity crew line", () => {
    const zero = line({
      quantity: 0,
      unit: "day",
      unit_price: 400,
      people: [{ label: "Jacob", days: 2, day_rate: 250 }],
    });
    expect(Number.isFinite(displayedUnitRate(zero))).toBe(true);
    expect(displayedUnitRate(zero)).toBe(400);
  });
});

describe("a single-person crew", () => {
  it("shows that person's own day rate", () => {
    const solo = line({
      quantity: 4,
      unit: "day",
      unit_price: 999,
      people: [{ label: "Jacob", days: 4, day_rate: 250 }],
    });
    expect(lineItemTotal(solo)).toBe(1000);
    expect(displayedUnitRate(solo)).toBe(250);
  });
});
