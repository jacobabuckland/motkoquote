/**
 * A price stated per unit is matched against the unit rate, not the line total.
 *
 * `reconcileStatedPrice` blocks the send when a stated amount reaches no line.
 * It compared every stated amount against `lineItemTotal`, which is right for a
 * lump sum — the total absorbs quantity, multiplier and people_count.
 *
 * That comparison survived only because per-unit prices used to reach a line of
 * ONE. "Eight bags of bonding at eleven pounds a bag" produced quantity 1, whose
 * total was £11, and it matched the stated £11 by accident. Teaching the
 * compiler the contractor's own count (#789) made the line eight bags totalling
 * £88 — correct, and now matching nothing:
 *
 *     Amount mismatch: stated £11.00 for "finishing plaster"
 *     but no line at that value was found.
 *
 * Measured on all three quote runs of 16 Sep, on every per-unit line in them.
 * The quote was priced exactly as the contractor said it and could not be sent,
 * and the message told them to fix a line that was already right. A blocking
 * gate firing on correct input is worse than the undercharge it replaced.
 *
 * The lump-sum arm is untouched, and the per-unit arm deliberately skips lines
 * carrying a crew breakdown: there `unit_price` is a denormalised cache that
 * `lineItemTotal` ignores, so matching on it would match a number the quote
 * does not charge.
 */

import { describe, expect, it } from "vitest";
import { reconcileStatedPrice } from "@/lib/stated-price-guard";
import type { LineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";

const statedPrice = (
  amount: number,
  item: string,
  each: boolean,
  quantity?: number,
): StatedPrice => ({
  amount,
  item,
  transcript_span: `${item} at ${amount}`,
  qualifiers: { each, fitted: false, already_paid: false, excluded: false },
  superseded_by: null,
  refused: false,
  ...(quantity == null ? {} : { quantity }),
});

const material = (description: string, quantity: number, unit_price: number): LineItem =>
  ({
    description,
    category: "materials",
    quantity,
    unit: "unit",
    unit_price,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    provenance: { source: "transcript", transcript_span: description },
  }) as unknown as LineItem;

const reconcile = (prices: StatedPrice[], lines: LineItem[]) =>
  reconcileStatedPrice({ stated_prices: prices }, lines) ?? "";

describe("the per-unit lines from the 16 Sep runs", () => {
  it("accepts eight bags at the eleven pounds a bag that was stated", () => {
    const flag = reconcile(
      [statedPrice(1100, "finishing plaster", true, 8)],
      [material("Finishing plaster – walls in two bedrooms", 8, 11)],
    );

    expect(flag).not.toContain("Amount mismatch");
  });

  it("accepts the cafe's parking and primer", () => {
    // "Parking's £12 a shift for one van, three shifts" → 3 × £12 = £36.
    // "two tubs of primer at £27 each"                  → 2 × £27 = £54.
    const flag = reconcile(
      [statedPrice(1200, "Parking", true), statedPrice(2700, "primer", true, 2)],
      [material("Parking – one van, per shift", 3, 12), material("Primer", 2, 27)],
    );

    expect(flag).not.toContain("Amount mismatch");
  });
});

describe("what the gate still catches", () => {
  it("flags a per-unit price that reaches no line at all", () => {
    const flag = reconcile(
      [statedPrice(1100, "finishing plaster", true, 8)],
      [material("Bonding", 8, 14.5)],
    );

    expect(flag).toContain("Amount mismatch");
  });

  it("still matches a lump sum on its total, and flags one that misses", () => {
    // "£88 for protection" is not per-unit and must keep matching on the total.
    const ok = reconcile(
      [statedPrice(8800, "protection", false)],
      [material("Surface protection", 1, 88)],
    );
    expect(ok).not.toContain("Amount mismatch");

    const missed = reconcile(
      [statedPrice(8800, "protection", false)],
      [material("Surface protection", 1, 60)],
    );
    expect(missed).toContain("Amount mismatch");
  });

  it("does not let a lump sum match a unit rate", () => {
    // £88 stated as a whole, against a line of 4 at £88 totalling £352. The
    // per-unit arm must not rescue this — nothing here charges £88.
    const flag = reconcile(
      [statedPrice(8800, "protection", false)],
      [material("Surface protection", 4, 88)],
    );

    expect(flag).toContain("Amount mismatch");
  });
});

describe("a labour line priced from its crew", () => {
  it("is not matched on the unit_price cache", () => {
    // lineItemTotal ignores unit_price entirely when `people` is present, so a
    // stated amount matching it matches a number the quote does not charge.
    const crewLine = {
      description: "Plastering labour",
      category: "labour",
      quantity: 4,
      unit: "day",
      unit_price: 235,
      multiplier: 1,
      people_count: 1,
      overtime: false,
      assumed: false,
      people: [
        { label: "Owner", days: 2, day_rate: 250 },
        { label: "Daniel (Plasterer)", days: 2, day_rate: 220 },
      ],
      provenance: { source: "contractor" },
    } as unknown as LineItem;

    const flag = reconcile([statedPrice(23500, "labour", true)], [crewLine]);

    expect(flag, "£235 is a cache, not a charge — the line bills £940").toContain(
      "Amount mismatch",
    );
  });
});
