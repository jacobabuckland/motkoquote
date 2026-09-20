/**
 * "1 bag — £96.00" for a £96 material allowance covering eight bags.
 *
 * #844 stopped a stated COUNT multiplying a lump-sum line, which protected the
 * total as it stands. This protects the next edit. Collapsing to a quantity of
 * one is right — the amount is the whole thing — but leaving the drafted unit
 * behind makes the line say something false, to the customer reading it and to
 * the contractor editing it:
 *
 *   drafted:  8 bags of finish
 *   said:     "the material allowance is ninety six pounds"
 *   line:     1 bag x GBP 96.00
 *
 * Two things are wrong with that line. It prices one bag at GBP 96, so nudging
 * the quantity to 2 bills GBP 192 for a GBP 96 allowance — the same overcharge
 * #844 fixed, arriving by hand instead of by guard. And the eight has vanished
 * from the document entirely: a customer reading "1 bag" is not reading the job.
 *
 * A unit that already names the whole thing is true and is left alone.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import type { DraftLineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import type { StatedQuantity } from "@/lib/voice/stated-quantities";

const ctx = (over: Partial<CompileContext> = {}): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 0,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
  labour_plan: null,
  ...over,
});

const material = (unit: string, quantity = 1): DraftLineItem => ({
  kind: "material",
  description: "Finish",
  quantity,
  unit,
  estimated_unit_cost_pence: 1200,
  supplied_by: "contractor",
});

const price = (over: Partial<StatedPrice> = {}): StatedPrice => ({
  amount: 9600,
  item: "finish",
  quantity: null,
  caps_item: null,
  transcript_span: "the material allowance is ninety six pounds",
  qualifiers: { each: false, fitted: false, already_paid: false, excluded: false },
  superseded_by: null,
  refused: false,
  ...over,
});

const line = (draft: DraftLineItem, prices: StatedPrice[], counts: StatedQuantity[] = []) =>
  compileDraftToLineItems([draft], ctx(), [], prices, counts).lineItems[0]!;

describe("a lump sum prices the whole thing, and the unit says so", () => {
  it("stops a bag line claiming one bag costs the whole allowance", () => {
    const l = line(material("bag"), [price()]);

    expect(l.quantity).toBe(1);
    expect(l.unit_price).toBe(96);
    expect(l.unit).not.toBe("bag");
  });

  it("does the same where the draft counted eight of them", () => {
    // The eight is gone from the line either way -- the amount covers them all
    // -- so the unit is the only thing left that can avoid saying "one bag".
    expect(line(material("bag", 8), [price()]).unit).not.toBe("bag");
  });

  it("does the same for a measure, not just a countable unit", () => {
    expect(line(material("m2", 20), [price()]).unit).not.toBe("m2");
  });

  it("charges the stated amount once, whatever the draft counted", () => {
    for (const drafted of [1, 8, 20]) {
      const l = line(material("bag", drafted), [price()]);
      expect(l.quantity * l.unit_price, `drafted ${drafted}`).toBe(96);
    }
  });
});

describe("a unit that is already the whole thing is true, and is left alone", () => {
  it("keeps a set, which is what a bathroom suite is sold as", () => {
    expect(line(material("set"), [price()]).unit).toBe("set");
  });

  it("keeps a job and a lot", () => {
    expect(line(material("job"), [price()]).unit).toBe("job");
    expect(line(material("lot"), [price()]).unit).toBe("lot");
  });
});

describe("a per-unit price is a rate, so its unit still means something", () => {
  it("leaves the drafted unit alone when the price is per-unit", () => {
    const perUnit = price({
      amount: 1200,
      transcript_span: "finish is twelve pounds a bag",
      qualifiers: { each: true, fitted: false, already_paid: false, excluded: false },
    });
    const l = line(material("bag"), [perUnit], [
      { item: "finish", quantity: 8, unit: "bag", transcript_span: "eight bags of finish" },
    ]);

    expect(l.unit).toBe("bag");
    expect(l.quantity).toBe(8);
    expect(l.quantity * l.unit_price).toBe(96);
  });

  it("leaves an unpriced line exactly as it was drafted", () => {
    const l = line(material("bag", 8), []);

    expect(l.unit).toBe("bag");
    expect(l.quantity).toBe(8);
    expect(l.unpriced).toBe(true);
  });
});

describe("it does not make noise about the unit it just changed", () => {
  it("raises no quantity-mismatch flag against its own lump-sum unit", () => {
    // The line is "1 lot" now and the contractor said eight bags. #844 already
    // stands the count guard down on a lump-sum-priced line, so this must not
    // arrive as a refusal the contractor has to read and dismiss.
    const { contractorFlags } = compileDraftToLineItems(
      [material("bag")],
      ctx(),
      [],
      [price()],
      [{ item: "finish", quantity: 8, unit: "bag", transcript_span: "eight bags of finish" }],
    );

    expect(contractorFlags.filter((f) => f.startsWith("Quantity not applied:"))).toEqual([]);
  });
});
