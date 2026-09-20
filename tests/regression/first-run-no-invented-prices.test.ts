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
  // Behaviour before `labour_plan` existed: the labour line was always
  // attributed to the contractor, which is now what a STATED duration means.
  labour_plan: { people_count: 1, duration_days: 2, crew_description: null },
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
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

// RETIRED — the whole of `describe("established account — estimates still
// price")`, both assertions, superseded by the decision of 20 Sep 2026: an
// unconfirmed material estimate is never charged, on any account.
//
// Both pinned the SAME thing from opposite sides — that `has_pricing_history`
// being true (or absent, which defaults to true) lets the model's £12 estimate
// through at £14.40. That gate is gone. Note what the first one shows about
// why: its context carries a confirmed price for *Sand* while the line being
// priced is plaster, and it passed. The gate asked whether the ACCOUNT had
// history when the question is what THIS material costs — which is the
// argument `compileProvisional` had already made against the same gate.
//
// The first run's own cases above are untouched and still run, as is
// `hasPricingHistory` below: the helper still answers what it always did, and
// the flag still decides what the refusal SAYS. It no longer decides whether
// there is one.
//
// What replaced them: `tests/regression/an-estimate-is-a-suggestion-until-its-confirmed.test.ts`.

describe("hasPricingHistory", () => {
  it("is false only when the contractor has nothing at all to price from", () => {
    expect(
      hasPricingHistory({ knownMaterialPrices: [], rateCards: [], pastQuoteCount: 0 }),
    ).toBe(false);
  });

  it("counts any one of a confirmed price, a rate card, or a past quote", () => {
    expect(
      hasPricingHistory({
        knownMaterialPrices: [{ description: "Sand", unit: "bag", unit_price: 4 }],
        rateCards: [],
        pastQuoteCount: 0,
      }),
    ).toBe(true);
    expect(
      hasPricingHistory({
        knownMaterialPrices: [],
        rateCards: [{ id: "r1", work_type: "Downlight", unit: "each", rate_per_unit: 45 }],
        pastQuoteCount: 0,
      }),
    ).toBe(true);
    expect(
      hasPricingHistory({
        knownMaterialPrices: [],
        rateCards: [],
        pastQuoteCount: 1,
      }),
    ).toBe(true);
  });
});
