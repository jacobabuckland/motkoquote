import { describe, it, expect } from "vitest";
import { compareRun, traceStatedPrices } from "@/lib/run-view";
import type { LineItem } from "@/lib/schemas/job";

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

const price = (overrides: {
  amount: number;
  item?: string | null;
  superseded_by?: number | null;
  excluded?: boolean;
  already_paid?: boolean;
}) => ({
  amount: overrides.amount,
  item: overrides.item ?? "the works",
  transcript_span: "spoken",
  superseded_by: overrides.superseded_by ?? null,
  qualifiers: {
    each: false,
    fitted: false,
    already_paid: overrides.already_paid ?? false,
    excluded: overrides.excluded ?? false,
  },
});

describe("compareRun", () => {
  it("names a fixed-mode collapse a collapse, not deletions", () => {
    const drafted = [
      line({ description: "Labour", unit_price: 1000 }),
      line({ description: "Materials", unit_price: 500 }),
      line({ description: "Travel", unit_price: 100 }),
    ];
    const active = [line({ description: "Works as described", unit_price: 1600 })];

    const result = compareRun(drafted, active);

    expect(result.kind).toBe("collapsed");
    // The number that matters: it must NOT be reported as two removals.
    if (result.kind === "collapsed") {
      expect(result.draftedCount).toBe(3);
      expect(result.activeCount).toBe(1);
    }
  });

  it("reports a hand-typed quote as having no draft rather than as total deletion", () => {
    const result = compareRun([], [line({ description: "Rewire", unit_price: 4000 })]);

    expect(result.kind).toBe("no-draft");
    if (result.kind === "no-draft") expect(result.activeCount).toBe(1);
  });

  it("reports an unchanged quote as identical", () => {
    const items = [line({ description: "Labour" }), line({ description: "Materials" })];

    expect(compareRun(items, items)).toEqual({ kind: "identical", count: 2 });
  });

  it("reports a genuine edit with what went and what arrived", () => {
    const drafted = [line({ description: "Labour" }), line({ description: "Skip hire" })];
    const active = [line({ description: "Labour" }), line({ description: "Waste removal" })];

    const result = compareRun(drafted, active);

    expect(result.kind).toBe("edited");
    if (result.kind === "edited") {
      expect(result.removed).toEqual(["Skip hire"]);
      expect(result.added).toEqual(["Waste removal"]);
    }
  });

  it("does not read a single drafted line replaced by a single line as a collapse", () => {
    const result = compareRun(
      [line({ description: "Labour" })],
      [line({ description: "Works as described" })],
    );

    expect(result.kind).toBe("edited");
  });
});

describe("traceStatedPrices", () => {
  it("finds a spoken price that reached the quote", () => {
    const active = [line({ description: "Works", quantity: 1, unit_price: 5000 })];

    const [trace] = traceStatedPrices([price({ amount: 500_000 })], active, active);

    expect(trace?.stage).toBe("in-final");
  });

  it("separates a price lost before drafting from one lost after", () => {
    const drafted = [line({ description: "Works", unit_price: 5000 })];
    const active = [line({ description: "Works as described", unit_price: 5 })];

    // £5,000 was drafted and is gone from the final lines.
    const [afterDraft] = traceStatedPrices([price({ amount: 500_000 })], drafted, active);
    expect(afterDraft?.stage).toBe("lost-after-drafting");

    // £900 was never drafted at all.
    const [atDraft] = traceStatedPrices([price({ amount: 90_000 })], drafted, active);
    expect(atDraft?.stage).toBe("lost-at-drafting");
  });

  it("does not report a superseded, excluded or already-paid price as lost", () => {
    const traces = traceStatedPrices(
      [
        price({ amount: 100_00, superseded_by: 200_00 }),
        price({ amount: 300_00, excluded: true }),
        price({ amount: 400_00, already_paid: true }),
      ],
      [],
      [],
    );

    expect(traces.map((t) => t.stage)).toEqual([
      "not-expected",
      "not-expected",
      "not-expected",
    ]);
  });

  it("returns nothing when no prices were spoken", () => {
    expect(traceStatedPrices(null, [], [])).toEqual([]);
  });
});
