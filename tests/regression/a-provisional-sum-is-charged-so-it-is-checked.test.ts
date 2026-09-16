/**
 * A provisional sum is in the subtotal, so the per-amount guard looks at it.
 *
 * `reconcileStatedPrice` blocks the send when a stated amount reaches no line,
 * and it matched only `definedWorksLines` — everything except provisional sums.
 * But a provisional sum IS charged; that is what a provisional sum is. So the
 * check answered the wrong question in both directions:
 *
 *   * A stated £200 sitting on a £200 provisional line came back "no line at
 *     that value was found" — a false refusal on a correct quote, the same
 *     class #793 fixed on the per-unit arm.
 *   * A price wrongly applied to TWO provisional lines came back the same way,
 *     absent rather than duplicated. That is why £414 of double-charged
 *     plaster carried no duplicate warning at all (job d2fa171f, 16 Sep) —
 *     the guard that would have caught it could not see the lines.
 *
 * The UNSOURCED arm deliberately still uses the narrower set: a provisional sum
 * is a figure the model suggested, so it is unsourced by definition and
 * flagging every one of them would say nothing at all.
 */

import { describe, expect, it } from "vitest";
import { reconcileStatedPrice } from "@/lib/stated-price-guard";
import type { LineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";

const stated = (amount: number, item: string, each = false): StatedPrice => ({
  amount,
  item,
  transcript_span: item,
  qualifiers: { each, fitted: false, already_paid: false, excluded: false },
  superseded_by: null,
  refused: false,
});

const line = (
  description: string,
  quantity: number,
  unit_price: number,
  provisional: boolean,
): LineItem =>
  ({
    description,
    category: "other",
    quantity,
    unit: "sum",
    unit_price,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    ...(provisional ? { provisional: true } : {}),
    provenance: { source: "transcript", transcript_span: description },
  }) as unknown as LineItem;

const reconcile = (prices: StatedPrice[], lines: LineItem[]) =>
  reconcileStatedPrice({ stated_prices: prices }, lines) ?? "";

describe("a stated amount that landed on a provisional sum", () => {
  it("is not reported missing", () => {
    const flag = reconcile(
      [stated(20000, "making good")],
      [line("Making good", 1, 200, true)],
    );

    expect(flag, "the £200 is on the quote, and on the line it was said for").not.toContain(
      "Amount mismatch",
    );
  });

  it("is treated exactly as it would be on an ordinary line", () => {
    const asProvisional = reconcile([stated(20000, "making good")], [line("Making good", 1, 200, true)]);
    const asOrdinary = reconcile([stated(20000, "making good")], [line("Making good", 1, 200, false)]);

    expect(asProvisional).toBe(asOrdinary);
  });
});

describe("one price wrongly on two provisional lines", () => {
  // Run 1's shape. Charged twice, and invisible to the check that exists to
  // catch being charged twice.
  const TWICE = [
    line("Bonding and multi-finish", 18, 11.5, true),
    line("Plasterboard and finish", 18, 11.5, true),
  ];

  it("is named as the duplicate it is, not as an absence", () => {
    const flag = reconcile([stated(1150, "finish", true)], TWICE);

    expect(flag).toContain("Duplicate amount");
    expect(flag).toContain("appears on 2 lines");
    expect(flag, "it was on two lines — saying it was on none sent them hunting").not.toContain(
      "no line at that value was found",
    );
  });
});

describe("what the guard must still refuse", () => {
  it("flags a stated amount that genuinely reaches nothing", () => {
    const flag = reconcile(
      [stated(26100, "whole lot")],
      [line("Labour", 1, 250, false), line("Waste removal", 1, 0, true)],
    );

    expect(flag).toContain("Amount mismatch");
  });

  it("does not start flagging every provisional sum as unsourced", () => {
    // A provisional sum is the model's suggestion by definition. The unsourced
    // arm keeps the narrower set, so widening the per-amount arm must not drag
    // provisionals into it.
    const noProvenance = { ...line("Waste removal", 1, 150, true), provenance: undefined };
    const flag = reconcile([stated(15000, "waste")], [noProvenance as LineItem]);

    expect(flag).not.toContain("Unsourced line");
  });
});
