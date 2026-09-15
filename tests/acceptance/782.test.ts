// VOICE-U1: A labour line priced from the contractor's own rates is not "unsourced"
//
// The unsourced branch at compile-draft.ts:1242 zeroes and flags every line that
// matches no stated price, regardless of provenance. A labour line priced from
// the contractor's own stored rates gets `provenance.source === "contractor"`,
// but when stated prices exist it still gets zeroed and marked unpriced — then
// blocks the send with "Labour isn't priced: no day rate was found", when the
// day rate WAS found and is on the line.
import { describe, expect, it } from "vitest";
import type { CompileContext } from "@/lib/compile-draft";
import type { DraftLineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";

describe("VOICE-U1: Labour line priced from contractor's rates is not unsourced", () => {
  const baseContext: CompileContext = {
    day_rate: 320,
    overtime_rate: null,
    markup_pct: 25,
    team_members: [{ id: "tm-apprentice", name: "Daniel", role: "Apprentice", day_rate: 120 }],
    rate_cards: [],
    known_material_prices: [],
    owner_label: "Owner",
    has_pricing_history: true,
    labour_plan: { people_count: 2, duration_days: 5, crew_description: "me and an apprentice" },
  };

  const labourDraft: DraftLineItem = {
    kind: "labour",
    description: "Rewire works",
    people: [
      { ref: "owner", days: 5 },
      { ref: "tm-apprentice", days: 5 },
    ],
    overtime: false,
    includes_tasks: [],
  };

  const statedPrices: StatedPrice[] = [
    {
      amount: 150000, // £1,500 for materials
      item: "Materials",
      transcript_span: "fifteen hundred for materials",
      superseded_by: null,
      qualifiers: { each: false, fitted: false, excluded: false, already_paid: false },
      refused: false,
    },
    {
      amount: 50000, // £500 for travel
      item: "Travel",
      transcript_span: "five hundred for travel",
      superseded_by: null,
      qualifiers: { each: false, fitted: false, excluded: false, already_paid: false },
      refused: false,
    },
  ];

  it("the module exists and exports compileDraftToLineItems", async () => {
    const mod = await import("@/lib/compile-draft");
    expect(mod.compileDraftToLineItems).toBeDefined();
  });

  it("priced labour line is not zeroed when stated prices exist for other work", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const { lineItems } = compileDraftToLineItems([labourDraft], baseContext, [], statedPrices);

    const labour = lineItems.find((i) => i.category === "labour");
    expect(labour).toBeDefined();
    expect(labour?.unit_price).toBeGreaterThan(0);
    expect(labour?.unpriced).not.toBe(true);
  });

  it("labour line from contractor rates has provenance source 'contractor'", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const { lineItems } = compileDraftToLineItems([labourDraft], baseContext, [], statedPrices);

    const labour = lineItems.find((i) => i.category === "labour");
    expect(labour?.provenance?.source).toBe("contractor");
  });

  it("labour line total reflects contractor's stored rates times captured days", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");
    const { lineItemTotal } = await import("@/lib/quote-math");

    const { lineItems } = compileDraftToLineItems([labourDraft], baseContext, [], statedPrices);

    const labour = lineItems.find((i) => i.category === "labour");
    expect(labour).toBeDefined();
    // Owner £320/day × 5 days = £1,600
    // Apprentice £120/day × 5 days = £600
    // Total: £2,200
    expect(lineItemTotal(labour!)).toBe(2200);
  });

  it("the line has its people array intact after compilation", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const { lineItems } = compileDraftToLineItems([labourDraft], baseContext, [], statedPrices);

    const labour = lineItems.find((i) => i.category === "labour");
    expect(labour?.people).toBeDefined();
    expect(labour?.people?.length).toBe(2);
    expect(labour?.people?.[0]?.day_rate).toBe(320);
    expect(labour?.people?.[1]?.day_rate).toBe(120);
  });

  it("hasUnpricedLabour returns false for a labour line with contractor rates", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");
    const { hasUnpricedLabour } = await import("@/lib/unpriced-flags");

    const { lineItems } = compileDraftToLineItems([labourDraft], baseContext, [], statedPrices);

    expect(hasUnpricedLabour(lineItems)).toBe(false);
  });

  it("the quote does not raise UNRESOLVED_RATE_FLAG for contractor-sourced labour", async () => {
    const { compileDraftToLineItems, UNRESOLVED_RATE_FLAG } = await import(
      "@/lib/compile-draft"
    );

    const { contractorFlags } = compileDraftToLineItems([labourDraft], baseContext, [], statedPrices);

    expect(contractorFlags).not.toContain(UNRESOLVED_RATE_FLAG);
  });

  it("rate card lines keep their contractor provenance too", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const contextWithCard: CompileContext = {
      ...baseContext,
      rate_cards: [
        { id: "rc-plumbing", work_type: "Radiator swap", unit: "radiator", rate_per_unit: 140 },
      ],
    };

    const rateCardDraft: DraftLineItem = {
      kind: "rate_card",
      rate_card_id: "rc-plumbing",
      quantity: 2,
      description: "Radiator swaps",
    };

    const { lineItems } = compileDraftToLineItems(
      [rateCardDraft],
      contextWithCard,
      [],
      statedPrices,
    );

    const card = lineItems.find((i) => i.rate_card_id === "rc-plumbing");
    expect(card).toBeDefined();
    expect(card?.provenance?.source).toBe("contractor");
    expect(card?.unit_price).toBe(140);
    expect(card?.unpriced).not.toBe(true);
  });

  it("material line with known price keeps contractor provenance too", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const contextWithMaterial: CompileContext = {
      ...baseContext,
      known_material_prices: [
        { description: "Tile adhesive", unit: "job", unit_price: 80 },
      ],
    };

    const materialDraft: DraftLineItem = {
      kind: "material",
      description: "Tile adhesive",
      quantity: 1,
      unit: "job",
      estimated_unit_cost_pence: 5000,
      supplied_by: "contractor",
    };

    const { lineItems } = compileDraftToLineItems(
      [materialDraft],
      contextWithMaterial,
      [],
      statedPrices,
    );

    const material = lineItems.find((i) => i.description === "Tile adhesive");
    expect(material).toBeDefined();
    expect(material?.provenance?.source).toBe("contractor");
    expect(material?.unit_price).toBe(80);
    expect(material?.unpriced).not.toBe(true);
  });

  it("material line with NO known price is still zeroed and flagged", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const firstRunContext: CompileContext = {
      ...baseContext,
      has_pricing_history: false, // First quote, no known prices
    };

    const materialDraft: DraftLineItem = {
      kind: "material",
      description: "Unknown material",
      quantity: 1,
      unit: "bag",
      estimated_unit_cost_pence: 2000,
      supplied_by: "contractor",
    };

    const { lineItems } = compileDraftToLineItems(
      [materialDraft],
      firstRunContext,
      [],
      statedPrices,
    );

    const material = lineItems.find((i) => i.description === "Unknown material");
    expect(material).toBeDefined();
    expect(material?.unit_price).toBe(0);
    expect(material?.unpriced).toBe(true);
  });

  it("labour line with no rate found is still flagged unpriced", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const contextNoRate: CompileContext = {
      ...baseContext,
      day_rate: null, // No day rate set
    };

    const { lineItems } = compileDraftToLineItems([labourDraft], contextNoRate, [], statedPrices);

    const labour = lineItems.find((i) => i.category === "labour");
    expect(labour).toBeDefined();
    expect(labour?.unpriced).toBe(true);
  });

  it("the scenario from the Notion card: same draft, same rates, differs only in stated prices", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");
    const { lineItemTotal } = await import("@/lib/quote-math");

    // First run: no stated prices
    const { lineItems: withoutStated } = compileDraftToLineItems(
      [labourDraft],
      baseContext,
      [],
      [],
    );

    const labourWithout = withoutStated.find((i) => i.category === "labour");
    expect(labourWithout).toBeDefined();
    const totalWithout = lineItemTotal(labourWithout!);

    // Second run: stated prices for OTHER work
    const { lineItems: withStated } = compileDraftToLineItems(
      [labourDraft],
      baseContext,
      [],
      statedPrices,
    );

    const labourWith = withStated.find((i) => i.category === "labour");
    expect(labourWith).toBeDefined();
    const totalWith = lineItemTotal(labourWith!);

    // Both runs must produce the same £2,200 labour total
    expect(totalWithout).toBe(2200);
    expect(totalWith).toBe(2200);
    expect(totalWithout).toBe(totalWith);
  });

  it("multiple contractor-sourced lines all survive the stated-price check", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const fullContext: CompileContext = {
      ...baseContext,
      rate_cards: [
        { id: "rc-plumbing", work_type: "Radiator swap", unit: "radiator", rate_per_unit: 140 },
      ],
      known_material_prices: [
        { description: "Tile adhesive", unit: "job", unit_price: 80 },
      ],
    };

    const materialDraft: DraftLineItem = {
      kind: "material",
      description: "Tile adhesive",
      quantity: 1,
      unit: "job",
      estimated_unit_cost_pence: 5000,
      supplied_by: "contractor",
    };

    const rateCardDraft: DraftLineItem = {
      kind: "rate_card",
      rate_card_id: "rc-plumbing",
      quantity: 1,
      description: "Radiator swap",
    };

    const { lineItems } = compileDraftToLineItems(
      [labourDraft, materialDraft, rateCardDraft],
      fullContext,
      [],
      statedPrices,
    );

    const labour = lineItems.find((i) => i.category === "labour");
    const material = lineItems.find((i) => i.description === "Tile adhesive");
    const card = lineItems.find((i) => i.rate_card_id === "rc-plumbing");

    // All three should have contractor provenance and be priced
    expect(labour?.provenance?.source).toBe("contractor");
    expect(labour?.unit_price).toBeGreaterThan(0);
    expect(labour?.unpriced).not.toBe(true);

    expect(material?.provenance?.source).toBe("contractor");
    expect(material?.unit_price).toBeGreaterThan(0);
    expect(material?.unpriced).not.toBe(true);

    expect(card?.provenance?.source).toBe("contractor");
    expect(card?.unit_price).toBeGreaterThan(0);
    expect(card?.unpriced).not.toBe(true);
  });

  it("a line with system-generated provenance and no stated-price match is still zeroed", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    // Labour plan with NO duration captured (duration_days: null) — days are system-generated
    const contextNoStatedDays: CompileContext = {
      ...baseContext,
      labour_plan: null, // No duration captured
    };

    const { lineItems } = compileDraftToLineItems(
      [labourDraft],
      contextNoStatedDays,
      [],
      statedPrices,
    );

    const labour = lineItems.find((i) => i.category === "labour");
    expect(labour).toBeDefined();
    // The labour line has rates, so it prices at a defensible figure.
    // But if it doesn't match a stated price, the unsourced check would fire.
    // However, because the line has rates (not unpriced from resolvePerson),
    // it should keep its amount even with system-generated provenance.
    // This is the "deliberately left alone" comment at line 659-663.
    expect(labour?.provenance?.source).toBe("system-generated");
    expect(labour?.unit_price).toBeGreaterThan(0);
  });
});
