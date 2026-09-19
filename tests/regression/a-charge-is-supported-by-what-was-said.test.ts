/**
 * Three money defects from the 19 Sep evidence, each tested at the layer that
 * caused it rather than through another voice call.
 *
 * That separation is the point. All three were found by running the deployed
 * compiler and extractor directly on captured input; none of roughly twenty
 * live calls had triggered the first one at all, and a call is an expensive
 * way to rediscover a compiler defect.
 *
 * 1. A COUNT IN ONE UNIT MULTIPLIED A LINE PRICED IN ANOTHER.
 *    "8 bags of finish" against a line priced per PACK wrote 8 packs:
 *    £384 against a correct £96, a fourfold OVERCHARGE. A pack is four bags
 *    and nothing here knows that, so the rule is compatibility, never
 *    conversion.
 *
 * 2. A TOTAL THAT CONFIRMED A RATE WAS READ AS REPLACING IT.
 *    "8 bags at £12 a bag. That is £96. Do not multiply it twice." left the
 *    £12-each record carrying `superseded_by: 9600`, and the quote billed
 *    1 bag at £96. The total was right and the representation was wrong —
 *    which every total-based check passes.
 *
 * 3. A CUSTOMER-SUPPLIED MATERIAL WAS CHARGED FOR.
 *    `compileMaterial` zeroes these; `applyStatedPrice` then set a price
 *    without re-reading `supplied_by`, so the rule held until a stated price
 *    arrived. Scenario 41 shipped both payable materials marked
 *    customer-supplied.
 */

import { describe, expect, it } from "vitest";
import {
  compileDraftToLineItems,
  CUSTOMER_SUPPLIED_PRICED_PREFIX,
  STATED_QUANTITY_PREFIX,
  UNIT_MISMATCH_PREFIX,
  type CompileContext,
} from "@/lib/compile-draft";
import { extractStatedPrices } from "@/lib/voice/stated-prices";
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

const material = (
  over: Partial<Extract<DraftLineItem, { kind: "material" }>> = {},
): DraftLineItem => ({
  kind: "material",
  description: "Finish",
  quantity: 1,
  unit: "bag",
  supplied_by: "contractor",
  estimated_unit_cost_pence: 1200,
  ...over,
});

const count = (over: Partial<StatedQuantity> = {}): StatedQuantity => ({
  item: "finish",
  quantity: 8,
  unit: "bag",
  transcript_span: "8 bags of finish",
  ...over,
});

const charged = (line: { quantity: number; unit_price: number }) => line.quantity * line.unit_price;

describe("a count applies only where the line counts the same thing", () => {
  it("refuses a bag count on a line priced per pack, rather than charging four times over", () => {
    const withCtx = ctx({ known_material_prices: [{ description: "finish", unit_price: 48, unit: "pack" }] });
    const packLine = material({ unit: "pack", estimated_unit_cost_pence: 4800 });

    const before = compileDraftToLineItems([packLine], withCtx, [], [], []).lineItems[0]!;
    const after = compileDraftToLineItems([packLine], withCtx, [], [], [count()]);

    // The drafted line is preserved exactly — not converted, not multiplied.
    expect(after.lineItems[0]!.quantity).toBe(before.quantity);
    expect(charged(after.lineItems[0]!)).toBe(charged(before));
    expect(charged(after.lineItems[0]!)).not.toBe(384);
  });

  it("says so, naming both units, rather than refusing silently", () => {
    const withCtx = ctx({ known_material_prices: [{ description: "finish", unit_price: 48, unit: "pack" }] });
    const flags = compileDraftToLineItems(
      [material({ unit: "pack", estimated_unit_cost_pence: 4800 })],
      withCtx,
      [],
      [],
      [count()],
    ).contractorFlags;

    const flag = flags.find((f) => f.startsWith(UNIT_MISMATCH_PREFIX));
    expect(flag).toContain("8 bags");
    expect(flag).toContain("per pack");
  });

  it("still applies a count where the units agree", () => {
    const result = compileDraftToLineItems([material()], ctx(), [], [], [count()]);

    expect(result.lineItems[0]!.quantity).toBe(8);
    expect(result.contractorFlags.some((f) => f.startsWith(STATED_QUANTITY_PREFIX))).toBe(true);
  });

  it("lets a spoken unit govern a line whose own unit names nothing", () => {
    // "item" is the model declining to name a unit, not a claim about one.
    const result = compileDraftToLineItems([material({ unit: "item" })], ctx(), [], [], [count()]);

    expect(result.lineItems[0]!.quantity).toBe(8);
  });
});

describe("a total that confirms a rate does not replace it", () => {
  const scenario210 =
    "I will supply 8 bags of finish at £12 a bag. That is £96 for finish, at before VAT. " +
    "Do not multiply it twice.";

  it("keeps the per-unit rate the contractor stated", () => {
    const prices = extractStatedPrices(scenario210);

    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ amount: 1200, quantity: 8, superseded_by: null });
  });

  it("reaches the line as 8 bags at £12, not 1 bag at £96", () => {
    const [price] = extractStatedPrices(scenario210);
    const line = compileDraftToLineItems([material()], ctx(), [], [price!], []).lineItems[0]!;

    // The total was already right. What was wrong is everything under it — and
    // a contractor nudging that quantity to 2 would have charged £192.
    expect(charged(line)).toBe(96);
    expect(line.quantity).toBe(8);
    expect(line.unit_price).toBe(12);
  });

  it("still lets a genuine correction supersede", () => {
    const prices = extractStatedPrices("Finish is £12 a bag, no, make it £15 a bag.");

    expect(prices.find((p) => p.amount === 1200)?.superseded_by).toBe(1500);
  });

  it("still lets a total that disagrees with the arithmetic supersede", () => {
    // £150 is not 8 x £12. That is a real conflict, and the later word wins.
    const prices = extractStatedPrices("8 bags of finish at £12 a bag. Call it £150 for the finish.");

    expect(prices.find((p) => p.amount === 1200)?.superseded_by).toBe(15000);
  });
});

describe("a customer-supplied material contributes nothing", () => {
  const customerFinish = material({ supplied_by: "customer", estimated_unit_cost_pence: 0 });
  const statedPrice: StatedPrice = {
    amount: 1200,
    item: "finish",
    quantity: null,
    caps_item: null,
    transcript_span: "twelve pounds a bag",
    qualifiers: { each: false, fitted: false, already_paid: false, excluded: false },
    superseded_by: null,
    refused: false,
  };

  it("stays at £0 even when a stated price lands on it", () => {
    const line = compileDraftToLineItems([customerFinish], ctx(), [], [statedPrice], [])
      .lineItems[0]!;

    expect(line.supplied_by).toBe("customer");
    expect(charged(line)).toBe(0);
  });

  it("does not hide the ownership behind the zero", () => {
    // The likelier story is that ownership was captured wrong, and only the
    // contractor knows which. A silent £0 tells them neither.
    const flags = compileDraftToLineItems([customerFinish], ctx(), [], [statedPrice], [])
      .contractorFlags;

    const flag = flags.find((f) => f.startsWith(CUSTOMER_SUPPLIED_PRICED_PREFIX));
    expect(flag).toContain("£12.00");
    expect(flag).toContain("change");
  });

  it("leaves a contractor-supplied material priced as stated", () => {
    const line = compileDraftToLineItems([material()], ctx(), [], [statedPrice], []).lineItems[0]!;

    expect(charged(line)).toBe(12);
  });

  it("does not govern labour to fit the customer's own material", () => {
    // Fitting a customer's tiles is the contractor's work to charge for.
    const labour: DraftLineItem = {
      kind: "labour",
      description: "Tiling labour",
      people: [],
      overtime: false,
      includes_tasks: [],
    };
    const forLabour: StatedPrice = { ...statedPrice, item: "tiling labour", amount: 40000 };
    const line = compileDraftToLineItems([labour], ctx(), [], [forLabour], []).lineItems.find(
      (l) => l.category === "labour",
    )!;

    expect(charged(line)).toBe(400);
  });
});
