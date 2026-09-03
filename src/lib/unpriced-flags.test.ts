import { describe, it, expect } from "vitest";
import { clearUnpricedWhenPriced, reconcileUnpricedFlags } from "@/lib/unpriced-flags";
import { UNRESOLVED_RATE_FLAG, UNSOURCED_PRICE_FLAG } from "@/lib/compile-draft";
import { withStatedPriceFlag, isReconciliationFlag } from "@/lib/stated-price-guard";
import type { LineItem } from "@/lib/schemas/job";
import type { SowState } from "@/lib/schemas/sow";

// The 3 Sep live-call defect, and the two flag families behind it.
//
// Quote b3112196: fixed price £450, one works line at £450, subtotal £450,
// VAT £90, total £540 — every figure present — and the send refused with "no
// day rate was found, so the labour has no figure. Add your day rate in
// Business details." The day rate was £250 and had been for hours. The flag was
// a leftover from the original compile of four drafted lines, and nothing in
// the tree removed it, so there was no way out through the interface.

const line = (overrides: Partial<LineItem> & { description: string }): LineItem => ({
  category: "labour",
  quantity: 1,
  unit: "job",
  unit_price: 0,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...overrides,
});

describe("clearUnpricedWhenPriced", () => {
  it("clears the unpriced state once the contractor types a price", () => {
    const [item] = clearUnpricedWhenPriced([
      line({ description: "Works", unpriced: true, unit_price: 450 }),
    ]);

    expect(item?.unpriced).toBe(false);
  });

  it("reads the crew breakdown, not the denormalised unit price", () => {
    // A labour line priced from a team keeps unit_price only as a cache, so
    // reading it would miss a correctly priced crew.
    const [item] = clearUnpricedWhenPriced([
      line({
        description: "Two-person team",
        unpriced: true,
        unit_price: 0,
        people: [
          { label: "Owner", days: 5, day_rate: 320 },
          { label: "Apprentice", days: 5, day_rate: 120 },
        ],
      }),
    ]);

    expect(item?.unpriced).toBe(false);
  });

  it("leaves a line still at zero unpriced", () => {
    // Deliberately conservative: a £0.00 a customer reads as "free" is the
    // exact thing the flag exists to stop.
    const [item] = clearUnpricedWhenPriced([
      line({ description: "Plaster", category: "materials", unpriced: true }),
    ]);

    expect(item?.unpriced).toBe(true);
  });

  it("does not touch a customer-supplied £0 line", () => {
    const items = [
      line({
        description: "Suite — customer supplied",
        category: "materials",
        supplied_by: "customer",
      }),
    ];

    expect(clearUnpricedWhenPriced(items)).toEqual(items);
  });
});

describe("reconcileUnpricedFlags", () => {
  it("drops a blocking flag whose line no longer exists — the £540 quote", () => {
    // Fixed mode collapsed four drafted lines into one priced works line, so
    // the labour line the flag named is gone.
    const flags = reconcileUnpricedFlags(
      ["Job type was not specified — confirm before issuing.", UNRESOLVED_RATE_FLAG],
      [line({ description: "Works — see Scope of work", unit_price: 450 })],
    );

    expect(flags).not.toContain(UNRESOLVED_RATE_FLAG);
    // Everything that is not one of the two blocking flags is untouched.
    expect(flags).toEqual(["Job type was not specified — confirm before issuing."]);
  });

  it("keeps the flag while a labour line really is unpriced", () => {
    const flags = reconcileUnpricedFlags(
      [],
      [line({ description: "Labour", unpriced: true })],
    );

    expect(flags).toEqual([UNRESOLVED_RATE_FLAG]);
  });

  it("tells the two unpriced kinds apart, because the fix differs", () => {
    const flags = reconcileUnpricedFlags(
      [],
      [
        line({ description: "Labour", unpriced: true }),
        line({ description: "Plaster", category: "materials", unpriced: true }),
      ],
    );

    expect(flags).toContain(UNRESOLVED_RATE_FLAG);
    expect(flags).toContain(UNSOURCED_PRICE_FLAG);
  });

  it("raises a flag the previous state did not carry", () => {
    // Removal is not the only direction: an edit can introduce an unpriced
    // line, and the flag must appear rather than only ever being cleared.
    const flags = reconcileUnpricedFlags(
      [],
      [line({ description: "Skip hire", category: "other", unpriced: true })],
    );

    expect(flags).toEqual([UNSOURCED_PRICE_FLAG]);
  });

  it("does not duplicate a flag that is already present and still true", () => {
    const flags = reconcileUnpricedFlags(
      [UNRESOLVED_RATE_FLAG],
      [line({ description: "Labour", unpriced: true })],
    );

    expect(flags).toEqual([UNRESOLVED_RATE_FLAG]);
  });
});

describe("withStatedPriceFlag replaces rather than accumulates", () => {
  const sow = { pricing: null, stated_prices: [] } as Partial<SowState>;

  it("removes a stale reconciliation flag whichever kind opened it", () => {
    // The accumulation bug: the filter matched only the fixed-price prefix, so
    // a flag opening with any of the other four survived and a fresh copy was
    // appended each save. Quote b3112196 carried one string twice and another
    // three times.
    const stale = [
      'Unsourced line: "Works — see Scope of work" has no provenance. All lines must be sourced from the transcript or marked as contractor-added.',
      "Amount mismatch: stated £563889.00 for \"contact number\" but no line at that value was found.",
      "Duplicate amount: stated £140.00 appears on 2 lines. Each stated amount must appear exactly once.",
      'Double-charge detected: "skim" is included in the bundled line "Works" but also charged separately as "Skim".',
    ];

    const flags = withStatedPriceFlag(stale, sow, [
      line({ description: "Works", unit_price: 450 }),
    ]);

    expect(flags).toEqual([]);
  });

  it("keeps flags that are not reconciliation output", () => {
    const flags = withStatedPriceFlag(
      ["Materials supply was not confirmed during intake.", UNRESOLVED_RATE_FLAG],
      sow,
      [line({ description: "Works", unit_price: 450 })],
    );

    expect(flags).toEqual([
      "Materials supply was not confirmed during intake.",
      UNRESOLVED_RATE_FLAG,
    ]);
  });

  it("recognises each reconciliation opening", () => {
    for (const flag of [
      "Amount mismatch: stated £1.00",
      "Duplicate amount: stated £1.00",
      'Unsourced line: "x" has no provenance',
      'Double-charge detected: "x"',
    ]) {
      expect(isReconciliationFlag(flag), flag).toBe(true);
    }

    expect(isReconciliationFlag("Job type was not specified")).toBe(false);
    expect(isReconciliationFlag(UNRESOLVED_RATE_FLAG)).toBe(false);
  });
});
