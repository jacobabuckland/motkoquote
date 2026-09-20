/**
 * A material price nobody confirmed is a suggestion, not a payable line.
 *
 * D16 already refused to charge the drafting model's `estimated_unit_cost_pence`
 * — but only on an account with no pricing history at all. On every other
 * account the estimate was charged, with the contractor's markup on top.
 *
 * THE GATE WAS ASKING THE WRONG QUESTION, and `compileProvisional` had already
 * said so about the same gate, in the same file: it asks about the ACCOUNT when
 * the question is about the ITEM. `hasPricingHistory` is satisfied by a rate
 * card for unrelated work, or by the contractor having produced one past quote
 * — which may itself have been full of invented estimates. Neither tells anyone
 * what a bag of finish costs. The rationale written beside the gate ("the
 * contractor has confirmed prices we can sanity-check it against") describes
 * `known_material_prices`, which is consulted directly and wins outright when
 * it hits; the gate added nothing except a way through for everyone else.
 *
 * `tests/regression/first-run-no-invented-prices.test.ts` carried an assertion
 * that made this visible and was read for years as reassurance: an established
 * account with a confirmed price for SAND was allowed to charge an invented
 * price for PLASTER.
 *
 * The estimate is not thrown away. Charging it is one defect; losing it is
 * another, because a contractor made to source every price from nothing turns
 * the guard off. It goes to the contractor-only flag channel — which no
 * customer document renders — labelled as ours and plainly not charged.
 */

import { describe, expect, it } from "vitest";
import {
  compileDraftToLineItems,
  UNCONFIRMED_ESTIMATE_PREFIX,
  UNSOURCED_PRICE_FLAG,
  type CompileContext,
} from "@/lib/compile-draft";
import type { DraftLineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";

const ctx = (over: Partial<CompileContext> = {}): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 20,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  // An ESTABLISHED account throughout, except where a case says otherwise.
  // That is the whole point: the first run already refused.
  has_pricing_history: true,
  labour_plan: null,
  ...over,
});

const finish = (over: Partial<Extract<DraftLineItem, { kind: "material" }>> = {}): DraftLineItem => ({
  kind: "material",
  description: "Finishing plaster",
  quantity: 8,
  unit: "bag",
  supplied_by: "contractor",
  estimated_unit_cost_pence: 1200,
  ...over,
});

const statedPrice = (over: Partial<StatedPrice> = {}): StatedPrice => ({
  amount: 1100,
  item: "finishing plaster",
  quantity: null,
  caps_item: null,
  transcript_span: "eleven pounds a bag",
  qualifiers: { each: false, fitted: false, already_paid: false, excluded: false },
  superseded_by: null,
  refused: false,
  ...over,
});

const charged = (line: { quantity: number; unit_price: number }) => line.quantity * line.unit_price;

describe("an unconfirmed estimate is never charged", () => {
  it("does not bill the model's guess on an established account", () => {
    const { lineItems } = compileDraftToLineItems([finish()], ctx(), [], [], []);

    // £12 x 1.2 markup x 8 bags = £115.20 of money nobody said.
    expect(charged(lineItems[0]!)).toBe(0);
    expect(lineItems[0]!.unpriced).toBe(true);
  });

  it("keeps the line on the quote — the scope is still real", () => {
    const { lineItems } = compileDraftToLineItems([finish()], ctx(), [], [], []);

    expect(lineItems[0]!.description).toBe("Finishing plaster");
    expect(lineItems[0]!.quantity).toBe(8);
  });

  it("no longer asks whether the ACCOUNT has history", () => {
    // The two contexts differ only by the retired gate. They must now agree.
    const established = compileDraftToLineItems([finish()], ctx(), [], [], []).lineItems[0]!;
    const firstRun = compileDraftToLineItems(
      [finish()],
      ctx({ has_pricing_history: false }),
      [],
      [],
      [],
    ).lineItems[0]!;

    expect(established.unit_price).toBe(firstRun.unit_price);
    expect(established.unpriced).toBe(firstRun.unpriced);
  });

  it("is not satisfied by a confirmed price for a DIFFERENT material", () => {
    // The shape the old gate let through: history exists, but not for this.
    const { lineItems } = compileDraftToLineItems(
      [finish()],
      ctx({ known_material_prices: [{ description: "Sand", unit: "bag", unit_price: 4 }] }),
      [],
      [],
      [],
    );

    expect(charged(lineItems[0]!)).toBe(0);
  });
});

describe("the estimate reaches the contractor instead", () => {
  it("names the material and the figure it would have charged", () => {
    const { contractorFlags } = compileDraftToLineItems([finish()], ctx(), [], [], []);

    // `?? ""` on the receiver: `toContain` rejects an undefined receiver and
    // throws instead of asserting, which reports a matcher error where the
    // claim ("no flag was raised") is what failed.
    const flag = contractorFlags.find((f) => f.startsWith(UNCONFIRMED_ESTIMATE_PREFIX)) ?? "";
    expect(flag).toContain("Finishing plaster");
    // £12 plus the 20% markup that would have been applied — the figure the
    // contractor is being asked to judge, not the raw cost guess.
    expect(flag).toContain("£14.40");
  });

  it("says the figure is ours, so it cannot be read as sourced", () => {
    const { contractorFlags } = compileDraftToLineItems([finish()], ctx(), [], [], []);

    const flag = contractorFlags.find((f) => f.startsWith(UNCONFIRMED_ESTIMATE_PREFIX)) ?? "";
    expect(flag).toMatch(/not yours/i);
    expect(flag).toMatch(/not charged/i);
  });

  it("puts nothing on the LINE that a customer document could print", () => {
    // The PFIX-4 class, and the way this change could reintroduce it: an
    // invented figure reaching a customer by a new road. The flag channel is
    // contractor-only; the line must carry no trace of the number.
    const { lineItems } = compileDraftToLineItems([finish()], ctx(), [], [], []);
    const line = lineItems[0]!;

    expect(line.unit_price).toBe(0);
    expect(JSON.stringify({ note: line.customer_note ?? "" })).not.toContain("14.4");
    expect(line.provenance?.source).toBe("system-generated");
  });

  it("does not flag a line that has no estimate to offer", () => {
    const { contractorFlags } = compileDraftToLineItems(
      [finish({ estimated_unit_cost_pence: 0 })],
      ctx(),
      [],
      [],
      [],
    );

    expect(contractorFlags.some((f) => f.startsWith(UNCONFIRMED_ESTIMATE_PREFIX))).toBe(false);
  });

  it("still raises the quote-level flag, and no longer blames a first quote", () => {
    const { contractorFlags } = compileDraftToLineItems([finish()], ctx(), [], [], []);

    expect(contractorFlags).toContain(UNSOURCED_PRICE_FLAG);
    // An established contractor told "this is your first quote" learns to
    // ignore the flag, and this now fires on every account.
    expect(UNSOURCED_PRICE_FLAG).not.toMatch(/first quote/i);
  });
});

describe("what still prices, because something confirms it", () => {
  it("uses a price this contractor has confirmed for this material", () => {
    const { lineItems, contractorFlags } = compileDraftToLineItems(
      [finish()],
      ctx({
        known_material_prices: [{ description: "Finishing plaster", unit: "bag", unit_price: 15 }],
      }),
      [],
      [],
      [],
    );

    expect(lineItems[0]!.unit_price).toBe(15);
    expect(lineItems[0]!.unpriced).toBeUndefined();
    expect(contractorFlags.some((f) => f.startsWith(UNCONFIRMED_ESTIMATE_PREFIX))).toBe(false);
  });

  it("uses a price the contractor said out loud, and drops the refusal with it", () => {
    // "Until confirmed" — the call is one of the ways confirming happens.
    const { lineItems, contractorFlags } = compileDraftToLineItems(
      [finish()],
      ctx(),
      [],
      [statedPrice()],
      [],
    );

    expect(lineItems[0]!.unit_price).toBe(11);
    expect(lineItems[0]!.unpriced).toBeUndefined();
    // No suggestion either: telling them to enter a price they just gave is
    // how a flag channel becomes noise.
    expect(contractorFlags.some((f) => f.startsWith(UNCONFIRMED_ESTIMATE_PREFIX))).toBe(false);
  });

  it("leaves a customer-supplied material on its own rule, not this one", () => {
    const { lineItems, contractorFlags } = compileDraftToLineItems(
      [finish({ supplied_by: "customer" })],
      ctx(),
      [],
      [],
      [],
    );

    expect(lineItems[0]!.unit_price).toBe(0);
    // A real £0, not an absent price: the customer is buying it.
    expect(lineItems[0]!.unpriced).toBeUndefined();
    expect(lineItems[0]!.assumption_note).toMatch(/supplied by the customer/i);
    expect(contractorFlags.some((f) => f.startsWith(UNCONFIRMED_ESTIMATE_PREFIX))).toBe(false);
  });

  it("prices labour from the day rate, which this rule never touched", () => {
    const labour: DraftLineItem = {
      kind: "labour",
      description: "Skimming",
      people: [{ ref: "owner", days: 2 }],
      overtime: false,
      includes_tasks: [],
    };
    const line = compileDraftToLineItems([labour], ctx(), [], [], []).lineItems.find(
      (l) => l.category === "labour",
    )!;

    expect(charged(line)).toBe(500);
  });
});

describe("the instruction tells the contractor what to type", () => {
  it("asks for what they CHARGE, because that is what gets billed", () => {
    // Whatever is typed on the line is the customer's price — no markup is
    // added to it, and rememberMaterialPrices stores it as this contractor's
    // confirmed price for next time. "Add what you pay" asked for a cost and
    // then charged it, handing their margin to the customer. That wording was
    // first-run-only while the gate stood; widening the gate would have made
    // it the instruction on every quote.
    const { lineItems } = compileDraftToLineItems([finish()], ctx(), [], [], []);

    expect(lineItems[0]!.assumption_note ?? "").toMatch(/what you charge/i);
    expect(lineItems[0]!.assumption_note ?? "").not.toMatch(/what you pay/i);
  });
});
