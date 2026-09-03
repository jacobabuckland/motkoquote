// D16 — no monetary invention, first run included.
//
// The pricing contract has always held for LABOUR: the model proposes
// structure, code computes every amount, and an unresolvable rate produces an
// unpriced line rather than a figure. It did not hold for materials or
// provisional sums. Both carry a model-supplied amount — a material's
// `estimated_unit_cost_pence` and a provisional's `suggested_amount_pence` —
// and on a first run there is no confirmed price, no rate card and no past job
// to check either against. `statedPrices.length === 0` was read as "price
// extraction didn't run, so price materials normally", which is how a
// contractor's first quote arrived full of plausible figures nobody had said.

import { describe, expect, it } from "vitest";
import {
  compileDraftToLineItems,
  hasUnsourcedPriceFlag,
  hasUnresolvedRateFlag,
  type CompileContext,
} from "@/lib/compile-draft";
import { hasPricingHistory } from "@/lib/pricing-history";
import type { DraftLineItem } from "@/lib/schemas/job";

const context = (overrides: Partial<CompileContext> = {}): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 20,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  ...overrides,
});

// Typed to the specific member rather than the union: spreading a union-typed
// literal to override `supplied_by` below widens to every member and stops
// compiling. `customer_note`/`contractor_flag` are `string | undefined` after
// the schema's nullish transform, not `string | null`.
type DraftMaterial = Extract<DraftLineItem, { kind: "material" }>;

const material: DraftMaterial = {
  kind: "material",
  description: "Multi-finish plaster",
  quantity: 10,
  unit: "bag",
  estimated_unit_cost_pence: 1200,
  supplied_by: "contractor",
  customer_note: undefined,
  contractor_flag: undefined,
};

const provisional: DraftLineItem = {
  kind: "provisional",
  description: "Making good after first fix",
  suggested_amount_pence: 45000,
  reason: "Extent unknown until the walls are open",
  customer_note: undefined,
  contractor_flag: undefined,
};

describe("first run — no pricing history", () => {
  it("does not put an invented material price on the quote", () => {
    const { lineItems } = compileDraftToLineItems(
      [material],
      context({ has_pricing_history: false }),
      [],
      [],
    );

    const line = lineItems[0];
    expect(line.unpriced).toBe(true);
    // The model's £12/bag estimate must not survive into the document, with or
    // without the markup applied to it.
    expect(line.unit_price).toBe(0);
    expect(line.assumption_note).toMatch(/not priced/i);
  });

  it("does not put an invented provisional sum on the quote", () => {
    const { lineItems } = compileDraftToLineItems(
      [provisional],
      context({ has_pricing_history: false }),
      [],
      [],
    );

    expect(lineItems[0].unpriced).toBe(true);
    expect(lineItems[0].unit_price).toBe(0);
    expect(lineItems[0].provisional).toBe(true);
  });

  it("flags it for the contractor, and points at the right fix", () => {
    const { contractorFlags } = compileDraftToLineItems(
      [material],
      context({ has_pricing_history: false }),
      [],
      [],
    );

    // The materials flag, NOT the day-rate one: the day rate is on file and
    // sending someone to Settings to fix a bag of plaster is the wrong screen.
    expect(hasUnsourcedPriceFlag(contractorFlags)).toBe(true);
    expect(hasUnresolvedRateFlag(contractorFlags)).toBe(false);
  });

  it("still honours a price the contractor actually stated", () => {
    // The whole point of D16 is that a figure must trace to something the
    // contractor said. When one does, it prices — first run or not.
    const { lineItems } = compileDraftToLineItems(
      [material],
      context({
        has_pricing_history: false,
        known_material_prices: [
          { description: "Multi-finish plaster", unit: "bag", unit_price: 9.5 },
        ],
      }),
      [],
      [],
    );

    expect(lineItems[0].unit_price).toBe(9.5);
    expect(lineItems[0].unpriced).toBeUndefined();
  });

  it("leaves customer-supplied materials exactly as they were", () => {
    const { lineItems } = compileDraftToLineItems(
      [{ ...material, supplied_by: "customer" as const }],
      context({ has_pricing_history: false }),
      [],
      [],
    );

    expect(lineItems[0].unit_price).toBe(0);
    expect(lineItems[0].unpriced).toBeUndefined();
    expect(lineItems[0].assumption_note).toMatch(/supplied by the customer/i);
  });
});

describe("established account — estimates still price", () => {
  it("keeps the model's material estimate when there is history to check it against", () => {
    const { lineItems } = compileDraftToLineItems(
      [material],
      context({
        has_pricing_history: true,
        known_material_prices: [{ description: "Sand", unit: "bag", unit_price: 4 }],
      }),
      [],
      [],
    );

    // £12 a bag plus 20% markup.
    expect(lineItems[0].unit_price).toBe(14.4);
    expect(lineItems[0].assumed).toBe(true);
    expect(lineItems[0].unpriced).toBeUndefined();
  });

  it("behaves as it always did when the flag is not supplied at all", () => {
    // Every pre-existing caller omits has_pricing_history. Omission must mean
    // "assume history", or this change would silently unprice half the estate.
    const { lineItems } = compileDraftToLineItems([material], context(), [], []);

    expect(lineItems[0].unit_price).toBe(14.4);
    expect(lineItems[0].unpriced).toBeUndefined();
  });
});

describe("hasPricingHistory", () => {
  it("is false only when the contractor has nothing at all to price from", () => {
    expect(
      hasPricingHistory({ knownMaterialPrices: [], rateCards: [], similarPastJobs: [] }),
    ).toBe(false);
  });

  it("counts any one of a confirmed price, a rate card, or a past job", () => {
    expect(
      hasPricingHistory({
        knownMaterialPrices: [{ description: "Sand", unit: "bag", unit_price: 4 }],
        rateCards: [],
        similarPastJobs: [],
      }),
    ).toBe(true);
    expect(
      hasPricingHistory({
        knownMaterialPrices: [],
        rateCards: [{ id: "r1", work_type: "Downlight", unit: "each", rate_per_unit: 45 }],
        similarPastJobs: [],
      }),
    ).toBe(true);
    // PFIX-4: A past job must contain actual price figures to count as pricing history.
    // "Job type: downlights" has no prices, so it doesn't count.
    expect(
      hasPricingHistory({
        knownMaterialPrices: [],
        rateCards: [],
        similarPastJobs: ["Job type: downlights"],
      }),
    ).toBe(false);
    // But a past job with prices does count
    expect(
      hasPricingHistory({
        knownMaterialPrices: [],
        rateCards: [],
        similarPastJobs: ["Downlights: 10 @ £45 each = £450"],
      }),
    ).toBe(true);
  });
});
