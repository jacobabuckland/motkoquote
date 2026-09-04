import { describe, it, expect } from "vitest";
import {
  compileDraftToLineItems,
  UNATTACHED_STATED_PRICE_PREFIX,
  LABOUR_LOCK_REFUSED_PREFIX,
  type CompileContext,
} from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";

// PFIX-3. Both halves, reproduced against the real compiler before fixing.
//
// The over-match: matching ran per line and fell back to comparing the line
// against the whole spoken sentence on ONE shared word of three characters, no
// stop-word removal. "and" is three characters. From "The consumer unit is five
// hundred and twenty pounds", £520 attached to the consumer unit AND to "Twin
// and earth cable", for a subtotal of £1,640 from one stated price. The
// reconciliation gate then reported a duplicate and blocked the send — a quote
// the contractor could not send, with no explanation.
//
// The span is kept, because the extractor's `item` is often wrong in a way the
// span is not ("Labour will be six hundred pounds for two days" extracts as the
// item "two days"). What changed is that resolution now happens over the whole
// quote at once: an item match spends the price, and a span match is believed
// only when the pairing is one-to-one.
//
// The inert lock: applying a stated price set unit_price and quantity but left
// the crew breakdown intact, and lineItemTotal prefers the breakdown. A "locked"
// £520 on a two-day owner line still charged £600, silently.

const price = (overrides: Partial<StatedPrice> & { item: string }): StatedPrice => ({
  amount: 52000,
  transcript_span: "The consumer unit is five hundred and twenty pounds",
  qualifiers: { each: false, fitted: false, already_paid: false, excluded: false },
  superseded_by: null,
    refused: false,
  ...overrides,
});

const ctx: CompileContext = {
  day_rate: 300,
  overtime_rate: null,
  markup_pct: 0,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
};

const labour: DraftLineItem = {
  kind: "labour",
  description: "Rewire labour",
  people: [{ ref: "owner", days: 2 }],
  overtime: false,
  includes_tasks: [],
};

const material = (description: string, pence: number): DraftLineItem => ({
  kind: "material",
  description,
  quantity: 1,
  unit: "item",
  estimated_unit_cost_pence: pence,
  supplied_by: "contractor",
});

const compile = (drafts: DraftLineItem[], prices: StatedPrice[]) =>
  compileDraftToLineItems(drafts, ctx, [], prices);

describe("one stated price no longer lands on two lines", () => {
  const drafts = [labour, material("Consumer unit", 30000), material("Twin and earth cable", 200)];

  it("no longer writes one stated price onto an unrelated line", () => {
    const { lineItems } = compile(drafts, [price({ item: "consumer unit" })]);

    const cable = lineItems.find((l) => l.description === "Twin and earth cable");
    expect(cable, "the cable line should still exist").toBeDefined();
    // Was £520, matched on the word "and" in "five hundred and twenty".
    expect(lineItemTotal(cable!)).not.toBe(520);
  });

  it("still applies the price to the line it actually names", () => {
    const { lineItems } = compile(drafts, [price({ item: "consumer unit" })]);

    const unit = lineItems.find((l) => l.description === "Consumer unit");
    expect(lineItemTotal(unit!)).toBe(520);
  });

  it("no longer produces the £1,640 subtotal from a single £520", () => {
    const { lineItems } = compile(drafts, [price({ item: "consumer unit" })]);

    const subtotal = lineItems.reduce((sum, l) => sum + lineItemTotal(l), 0);
    expect(subtotal).not.toBe(1640);
  });

  it("flags a stated price that reaches no line at all", () => {
    // Previously only the span fallback could ever attach this, so removing it
    // means the price now attaches to nothing. That must be visible, never
    // silently dropped — it is the whole reason this fails safe.
    const { contractorFlags } = compile(drafts, [price({ item: "something nobody drafted" })]);

    const flag = contractorFlags.find((f) => f.startsWith(UNATTACHED_STATED_PRICE_PREFIX));
    expect(flag, "an unattached price must be flagged").toBeDefined();
    expect(flag).toContain("£520.00");
    expect(flag).toContain("five hundred and twenty");
  });

  it("does not flag a price that was deliberately suppressed", () => {
    // already_paid and excluded are answered by suppressing the line. That is
    // correct behaviour, not a price that went missing.
    const paid = price({
      item: "consumer unit",
      qualifiers: { each: false, fitted: false, already_paid: true, excluded: false },
    });

    const { contractorFlags } = compile(drafts, [paid]);

    expect(contractorFlags.some((f) => f.startsWith(UNATTACHED_STATED_PRICE_PREFIX))).toBe(false);
  });
});

describe("a stated price is refused on a crew-priced labour line", () => {
  it("leaves the crew breakdown and the computed total alone", () => {
    const { lineItems } = compile([labour], [price({ item: "Rewire labour" })]);

    const line = lineItems.find((l) => l.category === "labour");
    // 2 days x £300. The lock used to set unit_price and change nothing.
    expect(lineItemTotal(line!)).toBe(600);
    expect(line!.people).toHaveLength(1);
  });

  it("tells the contractor what could not be applied, and to which line", () => {
    const { contractorFlags } = compile([labour], [price({ item: "Rewire labour" })]);

    const flag = contractorFlags.find((f) => f.startsWith(LABOUR_LOCK_REFUSED_PREFIX));
    expect(flag).toBeDefined();
    expect(flag).toContain("£520.00");
    expect(flag).toContain("Rewire labour");
  });

  it("does not also report it as unattached — one flag, not two", () => {
    const { contractorFlags } = compile([labour], [price({ item: "Rewire labour" })]);

    expect(contractorFlags.filter((f) => f.startsWith(UNATTACHED_STATED_PRICE_PREFIX))).toHaveLength(
      0,
    );
  });

  it("refuses on a crew line with NO rates too, because applying is inert there as well", () => {
    // Measured both ways rather than assumed. lineItemTotal prefers `people`
    // whenever present, so the lock never governs while the breakdown stands:
    // with rates it lost to £600, without rates it produced £0. There is no
    // version of "apply" that works, and making one would mean clearing the
    // crew — which the 3 Sep decision forbids.
    //
    // So the contractor gets an unpriced labour line and a flag naming the £520
    // they stated. That blocks the send until they act, which is the honest
    // outcome; silently producing £0 is not.
    const noRateCtx: CompileContext = { ...ctx, day_rate: null };
    const { lineItems, contractorFlags } = compileDraftToLineItems([labour], noRateCtx, [], [
      price({ item: "Rewire labour" }),
    ]);

    const line = lineItems.find((l) => l.category === "labour");
    expect(line!.people, "the crew is preserved either way").toHaveLength(1);
    expect(contractorFlags.some((f) => f.startsWith(LABOUR_LOCK_REFUSED_PREFIX))).toBe(true);
  });
});

describe("a span match is believed only when nothing else could mean it", () => {
  // The extractor names this price "two days", which matches no line anyone
  // would write. Only the span still plainly says "labour".
  const misExtracted = price({
    item: "two days",
    amount: 60000,
    transcript_span: "Labour will be six hundred pounds for two days",
  });

  it("still matches a line the extractor's item got wrong", () => {
    const { lineItems } = compile([labour, material("Consumer unit", 30000)], [
      misExtracted,
    ]);

    const line = lineItems.find((l) => l.category === "labour");
    expect(line?.provenance?.source).toBe("transcript");
    expect(line?.provenance?.transcript_span).toBe(misExtracted.transcript_span);
  });

  it("refuses when two lines could equally be what was said", () => {
    // Both lines share "cable" with the span, and nothing claims the price by
    // item — so there is no way to tell which was meant.
    const ambiguous = price({
      item: "",
      amount: 12000,
      transcript_span: "The cable is a hundred and twenty pounds",
    });
    const { lineItems, contractorFlags } = compile(
      [material("Twin and earth cable", 200), material("Cable clips", 100)],
      [ambiguous],
    );

    for (const line of lineItems) {
      expect(lineItemTotal(line), `${line.description} should not be priced`).not.toBe(120);
    }
    expect(contractorFlags.some((f) => f.startsWith(UNATTACHED_STATED_PRICE_PREFIX))).toBe(true);
  });

  it("refuses when one line could have come from either of two things said", () => {
    const first = price({
      item: "",
      amount: 12000,
      transcript_span: "The cable is a hundred and twenty pounds",
    });
    const second = price({
      item: "",
      amount: 8000,
      transcript_span: "Cable clips are eighty pounds",
    });
    const { lineItems } = compile([material("Cable", 200)], [first, second]);

    const line = lineItems[0];
    expect(lineItemTotal(line)).not.toBe(120);
    expect(lineItemTotal(line)).not.toBe(80);
  });

  it("does not let a span reach a price another line already claimed by name", () => {
    // This is the production defect stated as a rule: "Twin and earth cable"
    // shares "and" with the span, but the consumer unit named the price.
    const { lineItems } = compile(
      [material("Consumer unit", 30000), material("Twin and earth cable", 200)],
      [price({ item: "consumer unit" })],
    );

    const cable = lineItems.find((l) => l.description === "Twin and earth cable");
    expect(lineItemTotal(cable!)).not.toBe(520);
  });
});

describe("behaviour that must not change", () => {
  it("applies a price to a non-labour line exactly as before", () => {
    const { lineItems } = compile([material("Consumer unit", 30000)], [
      price({ item: "consumer unit" }),
    ]);

    expect(lineItemTotal(lineItems[0]!)).toBe(520);
  });

  it("matches on the item's own words, not the sentence around it", () => {
    // Two shared significant words in the ITEM is still a match — that path is
    // untouched. Only the span fallback went.
    const { lineItems } = compile([material("New consumer unit", 30000)], [
      price({ item: "consumer unit" }),
    ]);

    expect(lineItemTotal(lineItems[0]!)).toBe(520);
  });

  it("compiles a quote with no stated prices unchanged", () => {
    const { lineItems, contractorFlags } = compile([labour], []);

    expect(lineItemTotal(lineItems[0]!)).toBe(600);
    expect(contractorFlags.some((f) => f.startsWith(UNATTACHED_STATED_PRICE_PREFIX))).toBe(false);
  });
});
