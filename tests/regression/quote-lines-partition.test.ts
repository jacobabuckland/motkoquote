import { describe, expect, it } from "vitest";
import {
  chargedLines,
  definedWorksLines,
  provisionalLines,
} from "@/lib/quote-lines";
import { computeQuoteTotals, sumLines } from "@/lib/quote-math";
import { reconcileStatedPrice } from "@/lib/stated-price-guard";
import { applyPricingMode } from "@/lib/pricing-mode";
import type { LineItem } from "@/lib/schemas/job";

/**
 * One layer owns which lines count, and the three consumers declare which set
 * they mean.
 *
 * computeQuoteTotals charges VAT on every line including provisional sums;
 * reconcileStatedPrice compares a fixed price against the defined works only;
 * applyPricingMode keeps the provisionals and replaces the defined works. Each
 * used to restate its own filter, five times across three files, so nothing
 * could show that they differ DELIBERATELY or check that they still agree.
 *
 * Quote 46e3d510 is what that cost: accepted at £2,160 with £555.98 of drafted
 * work deleted, while the reconciler compared £1,800 against a set that excluded
 * provisionals and found nothing to report.
 *
 * The subsets are NOT merged here and must not be — a provisional sum is charged
 * (so it is in the total) but is not part of the defined works (so a fixed price
 * does not cover it). This pins the partition instead: the two subsets are
 * disjoint, they cover everything, and their totals add up. Drift in any one
 * consumer breaks that arithmetic.
 */

const line = (over: Partial<LineItem> & { description: string }): LineItem => ({
  category: "materials",
  quantity: 1,
  unit: "unit",
  unit_price: 100,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

const mixed: LineItem[] = [
  line({ description: "Plastering labour", category: "labour", unit_price: 1099.98 }),
  line({ description: "Finishing plaster", unit_price: 900 }),
  line({ description: "PVA bonding agent", unit_price: 216 }),
  line({ description: "Provisional sum — making good", unit_price: 400, provisional: true }),
];

describe("the quote-line partition", () => {
  it("splits into two disjoint sets that cover everything", () => {
    const defined = definedWorksLines(mixed);
    const provisional = provisionalLines(mixed);

    expect(defined.length + provisional.length).toBe(chargedLines(mixed).length);
    // Disjoint: nothing appears in both.
    const overlap = defined.filter((d) => provisional.includes(d));
    expect(overlap).toEqual([]);
  });

  it("the totals add up — charged = defined works + provisional", () => {
    // The arithmetic that catches drift. If any consumer's idea of its own set
    // moves, one of these three stops agreeing with the other two.
    const charged = sumLines(chargedLines(mixed));
    const defined = sumLines(definedWorksLines(mixed));
    const provisional = sumLines(provisionalLines(mixed));

    expect(defined).toBe(2215.98);
    expect(provisional).toBe(400);
    // Each side rounds once, so allow the single penny that can separate them.
    expect(Math.abs(charged - (defined + provisional))).toBeLessThan(0.011);
  });

  it("totals exactly as every call site did before, per-line rounding included", () => {
    // NOT "sums raw and rounds once" — lineItemTotal rounds each line itself, so
    // sumLines rounds a total that is already made of rounded parts. Three lines
    // of 0.005 each round UP to 0.01, giving 0.03 rather than the 0.015 a raw
    // sum would produce.
    //
    // Pinned because it is somebody's money and this refactor must not move it.
    // If the rounding is ever consolidated, that is a decision about what a
    // customer is charged, and this test is where it has to be argued.
    const halfPennies = [
      line({ description: "a", unit_price: 0.005 }),
      line({ description: "b", unit_price: 0.005 }),
      line({ description: "c", unit_price: 0.005 }),
    ];
    expect(sumLines(halfPennies)).toBe(0.03);

    // And the equivalence that matters for the refactor: sumLines agrees with
    // the open-coded expression it replaced.
    const openCoded =
      Math.round(
        halfPennies.reduce((sum, item) => {
          const t = Math.round(item.quantity * item.unit_price * 100) / 100;
          return sum + t;
        }, 0) * 100,
      ) / 100;
    expect(sumLines(halfPennies)).toBe(openCoded);
  });
});

describe("each consumer means the set it declares", () => {
  it("VAT is charged on the provisional sum too", () => {
    // computeQuoteTotals means chargedLines. If it ever narrowed to the defined
    // works, the customer's total would silently drop by the allowance.
    const { subtotal, vat, total } = computeQuoteTotals(mixed, true);
    expect(subtotal).toBe(2615.98);
    expect(vat).toBe(523.2);
    expect(total).toBe(3139.18);
  });

  it("a fixed price is reconciled against the defined works, not the total", () => {
    // The contractor stated the works figure; the allowance prices separately.
    // Comparing against the charged set would fire on every correct fixed quote
    // that carries a provisional sum.
    const sow = { pricing: { mode: "fixed" as const, fixed_amount: 2215.98 } };
    expect(reconcileStatedPrice(sow, mixed)).toBeNull();

    // And it still catches a genuine mismatch.
    const wrong = { pricing: { mode: "fixed" as const, fixed_amount: 1800 } };
    expect(reconcileStatedPrice(wrong, mixed) ?? "").toContain("£1800.00");
  });

  it("a fixed-price collapse keeps the provisionals and replaces the works", () => {
    const active = applyPricingMode(mixed, {
      pricing: { mode: "fixed", fixed_amount: 1800 },
      job_type: "plastering",
    });

    expect(active).toHaveLength(2);
    expect(active[0]!.unit_price).toBe(1800);
    expect(active[1]!.description).toBe("Provisional sum — making good");
    expect(active[1]!.provisional).toBe(true);
  });

  it("the three consumers stay consistent on one quote", () => {
    // The end-to-end relationship, on the shape that went wrong in production.
    const sow = { pricing: { mode: "fixed" as const, fixed_amount: 2215.98 } };
    const active = applyPricingMode(mixed, { ...sow, job_type: "plastering" });

    // The collapse preserves what the customer is charged, because the stated
    // figure equals the defined works and the provisionals carry through.
    expect(sumLines(chargedLines(active))).toBe(sumLines(chargedLines(mixed)));
    // And the reconciler agrees there is nothing to report.
    expect(reconcileStatedPrice(sow, active)).toBeNull();
  });
});
