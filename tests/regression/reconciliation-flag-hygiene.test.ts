import { describe, expect, it } from "vitest";

import {
  isReconciliationFlag,
  reconcileStatedPrice,
  withStatedPriceFlag,
} from "@/lib/stated-price-guard";
import type { LineItem } from "@/lib/schemas/job";
import type { SowState } from "@/lib/schemas/sow";

// PFIX-8. A flag must describe the quote's CURRENT state: one copy while the
// problem is present, and gone the moment the contractor fixes what it names.
//
// It did neither. `withStatedPriceFlag` removed a stale flag by matching one
// prefix, while `reconcileStatedPrice` joins FIVE failure kinds and returns a
// string opening with whichever failed first — so for four kinds in five
// nothing was removed and every save appended a fresh copy. Quote `b3112196`
// on production carried eight flags, one string twice and another three times.
// That is how a contractor learns to stop reading them, and the reconciliation
// gate is the main protection the whole price-fidelity chain added.
//
// #532 matched all five openings. What was still missing is the property
// itself: nothing stopped a SIXTH kind being added with no prefix, which
// reintroduces the bug silently for that kind alone. So every case below drives
// the real `reconcileStatedPrice` to produce a flag and asserts the flag it
// produced is one `withStatedPriceFlag` can remove — the two sides checked
// against each other rather than against a hand-copied list.

const line = (over: Partial<LineItem> = {}): LineItem => ({
  description: "Consumer unit",
  category: "materials",
  quantity: 1,
  unit: "each",
  unit_price: 500,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  provenance: { source: "transcript", transcript_span: "the board is five hundred" },
  ...over,
});

const sow = (over: Partial<SowState> = {}): Partial<SowState> => ({
  pricing: { mode: "calculated", fixed_amount: null },
  stated_prices: [],
  ...over,
});

const statedPrice = (amountPence: number, item: string) => ({
  amount: amountPence,
  item,
  transcript_span: `${item} is ${amountPence / 100} pounds`,
  qualifiers: {
    each: false,
    fitted: false,
    already_paid: false,
    excluded: false,
  },
  superseded_by: null,
  refused: false,
});

// Each entry drives ONE failure kind out of the real function. The point of
// building them this way — rather than asserting on literal strings — is that a
// reworded message still passes and a message with no registered prefix still
// fails, which is the direction that matters.
const FAILURE_KINDS: {
  kind: string;
  sow: Partial<SowState>;
  lineItems: LineItem[];
}[] = [
  {
    kind: "stated fixed price disagrees with the priced lines",
    sow: sow({ pricing: { mode: "fixed", fixed_amount: 5000 } }),
    lineItems: [line({ unit_price: 500 })],
  },
  {
    kind: "a line has no provenance",
    sow: sow({ stated_prices: [statedPrice(50_000, "the board")] }),
    lineItems: [line({ provenance: undefined })],
  },
  {
    kind: "a stated amount reaches no line",
    sow: sow({ stated_prices: [statedPrice(140_000, "tiling labour")] }),
    lineItems: [line({ unit_price: 500 })],
  },
  {
    kind: "a stated amount appears on more than one line",
    sow: sow({ stated_prices: [statedPrice(50_000, "the board")] }),
    lineItems: [
      line({ description: "Consumer unit" }),
      line({ description: "Second board" }),
    ],
  },
];

describe("every reconciliation failure a quote can carry is one the next save removes", () => {
  it.each(FAILURE_KINDS)("$kind", ({ sow: sowState, lineItems }) => {
    const flag = reconcileStatedPrice(sowState, lineItems);

    // The fixture has to actually provoke the failure, or the case below is
    // vacuous — a green test proving nothing is worse than no test.
    expect(flag, "fixture did not provoke a failure").not.toBeNull();
    expect(isReconciliationFlag(flag ?? "")).toBe(true);
  });

  it.each(FAILURE_KINDS)("$kind — saving twice leaves one flag", ({ sow: sowState, lineItems }) => {
    const afterFirstSave = withStatedPriceFlag([], sowState, lineItems);
    const afterSecondSave = withStatedPriceFlag(afterFirstSave, sowState, lineItems);

    expect(afterFirstSave).toHaveLength(1);
    expect(afterSecondSave).toHaveLength(1);
    expect(afterSecondSave).toEqual(afterFirstSave);
  });

  it.each(FAILURE_KINDS)("$kind — a third save still leaves one", ({ sow: sowState, lineItems }) => {
    // Three rather than two because the production quote had one string twice
    // and another three times: the count is what a contractor sees.
    let flags: string[] = [];
    for (let save = 0; save < 3; save += 1) {
      flags = withStatedPriceFlag(flags, sowState, lineItems);
    }
    expect(flags).toHaveLength(1);
  });
});

describe("a flag clears when the contractor fixes what it names", () => {
  it("drops the stated-price mismatch once the lines add up", () => {
    const stated = sow({ pricing: { mode: "fixed", fixed_amount: 5000 } });

    const flagged = withStatedPriceFlag([], stated, [line({ unit_price: 500 })]);
    expect(flagged).toHaveLength(1);

    const fixed = withStatedPriceFlag(flagged, stated, [line({ unit_price: 5000 })]);
    expect(fixed).toEqual([]);
  });

  it("drops the unsourced-line flag once provenance is attached", () => {
    const stated = sow({ stated_prices: [statedPrice(50_000, "the board")] });

    const flagged = withStatedPriceFlag([], stated, [line({ provenance: undefined })]);
    expect(flagged).toHaveLength(1);

    const fixed = withStatedPriceFlag(flagged, stated, [line()]);
    expect(fixed).toEqual([]);
  });

  it("clears one kind and keeps the other when two were present", () => {
    // The card's edge case: fixing one failure must not clear a second that is
    // still real, and must not leave the first behind either.
    const twoProblems = sow({
      pricing: { mode: "fixed", fixed_amount: 9999 },
      stated_prices: [statedPrice(50_000, "the board")],
    });
    const flagged = withStatedPriceFlag([], twoProblems, [line({ provenance: undefined })]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain("Unsourced line");

    // Provenance attached; the fixed-amount disagreement is untouched.
    const oneLeft = withStatedPriceFlag(flagged, twoProblems, [line()]);
    expect(oneLeft).toHaveLength(1);
    expect(oneLeft[0] ?? "").not.toContain("Unsourced line");
    expect(isReconciliationFlag(oneLeft[0] ?? "")).toBe(true);
  });

  it("never touches a flag that is not a reconciliation flag", () => {
    // The filter removes by prefix, so an unrelated contractor flag sitting
    // beside it must survive every save.
    const unrelated = "Add your day rate in Settings before sending.";
    const stated = sow({ pricing: { mode: "fixed", fixed_amount: 5000 } });

    const flagged = withStatedPriceFlag([unrelated], stated, [line({ unit_price: 500 })]);
    expect(flagged).toContain(unrelated);
    expect(flagged).toHaveLength(2);

    const fixed = withStatedPriceFlag(flagged, stated, [line({ unit_price: 5000 })]);
    expect(fixed).toEqual([unrelated]);
  });

  it("leaves a clean quote with no flag at all", () => {
    expect(withStatedPriceFlag([], sow(), [line()])).toEqual([]);
  });
});
