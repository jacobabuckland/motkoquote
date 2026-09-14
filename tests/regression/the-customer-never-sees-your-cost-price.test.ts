// The customer's quote showed the trade's BUYING PRICE in the UNIT PRICE column.
//
// Reported 13 Sep. A materials line — 18 sheets, Cost £11.50, Markup 2 — rendered
// identically in the editor, on the job page, and in the PDF the customer keeps:
//
//     18 sheet @ £11.50 ........................... £414.00
//
// Two things wrong with one row. 18 × £11.50 is £207.00, so a customer who
// multiplies sees an apparent double charge. And £11.50 is not a price at all:
// the field holding it is labelled **"Cost (£)"** in the editor, beside a
// **"Markup"** field whose helper text reads "2 = 100% on top of cost". It is
// what the trade paid.
//
// #734 fixed the same arithmetic for CREW lines and explicitly declined to
// apply it to the multiplier, calling an uplift "a different question about how
// an uplift should be presented". That was wrong, and the editor's own labels
// are what settle it — there is no question of presentation here, only a cost
// price on a customer document.
//
// A 100% materials markup is the profile default for a trade who sets one, so
// this is the ordinary path for materials rather than an edge case.
import { describe, expect, it } from "vitest";
import { displayedUnitRate, lineItemTotal } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Work",
  category: "materials",
  quantity: 1,
  unit: "item",
  unit_price: 100,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

/** The reported line, verbatim. */
const PLASTERBOARD = line({
  description: "Plasterboard",
  quantity: 18,
  unit: "sheet",
  unit_price: 11.5,
  multiplier: 2,
});

describe("the reported line", () => {
  it("still charges exactly what it charged — this fix moves no money", () => {
    expect(lineItemTotal(PLASTERBOARD)).toBe(414);
  });

  it("no longer shows the trade's cost price", () => {
    expect(displayedUnitRate(PLASTERBOARD)).not.toBe(11.5);
  });

  it("shows the rate actually being charged", () => {
    // £11.50 cost + 100% markup = £23.00 a sheet. 18 × £23.00 = £414.00.
    expect(displayedUnitRate(PLASTERBOARD)).toBe(23);
  });

  it("reconciles with its own total, which is the whole point", () => {
    expect(displayedUnitRate(PLASTERBOARD) * PLASTERBOARD.quantity).toBe(
      lineItemTotal(PLASTERBOARD),
    );
  });
});

describe("other markups", () => {
  it("handles a 50% uplift", () => {
    const access = line({ quantity: 4, unit: "day", unit_price: 200, multiplier: 1.5 });
    expect(lineItemTotal(access)).toBe(1200);
    expect(displayedUnitRate(access)).toBe(300);
  });

  it("handles a markup below 1 — a discount is not a defect", () => {
    const discounted = line({ quantity: 10, unit_price: 50, multiplier: 0.9 });
    expect(displayedUnitRate(discounted)).toBe(45);
  });
});

describe("lines that were already right are untouched", () => {
  it("leaves a plain line at its own price", () => {
    expect(displayedUnitRate(line({ quantity: 10, unit_price: 12.5 }))).toBe(12.5);
  });

  it("leaves a labour line with no markup alone", () => {
    const labour = line({ category: "labour", quantity: 3, unit: "day", unit_price: 250 });
    expect(displayedUnitRate(labour)).toBe(250);
  });

  it("still blends a crew line, which is what #734 fixed", () => {
    const crew = line({
      category: "labour",
      quantity: 24,
      unit: "day",
      unit_price: 934.33,
      people: [
        { label: "Jacob", days: 8, day_rate: 250 },
        { label: "Crew 2", days: 8, day_rate: 180 },
        { label: "Crew 3", days: 8, day_rate: 120 },
      ],
    });
    expect(lineItemTotal(crew)).toBe(4400);
    expect(displayedUnitRate(crew)).toBe(183.33);
  });

  it("does not divide by zero on a zero-quantity line", () => {
    const zero = line({ quantity: 0, unit_price: 400, multiplier: 2 });
    expect(Number.isFinite(displayedUnitRate(zero))).toBe(true);
    expect(displayedUnitRate(zero)).toBe(400);
  });

  it("handles a line with no multiplier stored at all", () => {
    // Quotes drafted before the field existed have it genuinely missing at
    // runtime — line_items_json is read through a cast, not parsed.
    const legacy = { ...line({ quantity: 5, unit_price: 20 }) } as LineItem;
    delete (legacy as Partial<LineItem>).multiplier;
    expect(displayedUnitRate(legacy)).toBe(20);
  });
});

describe("a crew line that ALSO carries a markup", () => {
  it("shows one rate that accounts for both", () => {
    // #734 left this case untested because it could not be created by hand.
    // It reconciles now for the same reason every other line does: the rate is
    // derived from the total.
    const crewWithUplift = line({
      category: "labour",
      quantity: 10,
      unit: "day",
      unit_price: 999,
      multiplier: 1.5,
      people: [{ label: "Jacob", days: 10, day_rate: 200 }],
    });
    expect(lineItemTotal(crewWithUplift)).toBe(3000);
    expect(displayedUnitRate(crewWithUplift)).toBe(300);
  });
});
