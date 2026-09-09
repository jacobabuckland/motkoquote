import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";

/**
 * Every line must say where its number came from — especially when nothing was
 * extracted from the transcript.
 *
 * `provenanceChecksEnabled = statedPrices.length > 0` gated provenance as well
 * as pricing, so a line was labelled with its source only when extraction had
 * already succeeded. The one case where the model is freest to invent — nothing
 * extracted, nothing to check against — was the exact case where nothing was
 * labelled.
 *
 * Quote 46e3d510 is what that looks like in production. The contractor said
 * £1,800 labour and £400 materials. `stated_prices` came back EMPTY, so the
 * £400 never became a line; it became a contractor flag, and the model drafted
 * four material lines of its own totalling £1,256 in its place. Every one of
 * them shipped with no provenance, and reconcileStatedPrice's unsourced-line
 * check — which also requires statedPrices to be non-empty — never ran. The
 * quote was accepted.
 *
 * WHAT THIS TEST DOES NOT ASSERT. Not that the model's estimates are refused:
 * on an established account an estimate is useful, marked assumed, and
 * deliberately kept (see the D16 note in compile-draft.ts). The defect is that
 * nothing downstream could tell such a figure from one the contractor actually
 * said. So this pins labelling, not pricing — pricing behaviour is unchanged and
 * B2.2 is where the collapse gets fixed.
 */

// The WHOLE CompileContext, not a partial. A partial literal compiles nowhere
// and runs everywhere — vitest ignores the missing fields and only tsc objects,
// which AGENTS.md calls out precisely because the objection arrives after the
// file is frozen. has_pricing_history defaults to true here so the estimate
// path (the 46e3d510 case) is what a bare ctx() exercises.
const ctx = (over: Partial<CompileContext> = {}): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 20,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Me",
  has_pricing_history: true,
  ...over,
});

const material = (description: string, pence: number) =>
  ({
    kind: "material" as const,
    description,
    quantity: 1,
    unit: "unit",
    supplied_by: "contractor" as const,
    estimated_unit_cost_pence: pence,
  });

describe("every priced line says where its number came from", () => {
  it("labels a model estimate as system-generated with NO stated prices at all", () => {
    // The 46e3d510 shape: extraction found nothing, the model estimated anyway.
    const { lineItems } = compileDraftToLineItems(
      [
        material("Finishing plaster (multi-finish)", 6000),
        material("PVA bonding agent", 7200),
        material("Scrim tape and consumables", 14000),
      ],
      ctx(),
      [],
      [], // <- statedPrices EMPTY. This is the whole defect.
    );

    expect(lineItems).toHaveLength(3);
    for (const line of lineItems) {
      expect(line.provenance, `"${line.description}" must be labelled`).toBeDefined();
      expect(line.provenance?.source).toBe("system-generated");
    }
  });

  it("still prices those estimates — this changes labelling, not money", () => {
    const { lineItems } = compileDraftToLineItems(
      [material("Finishing plaster", 6000)],
      ctx({ markup_pct: 20 }),
      [],
      [],
    );
    // 60.00 * 1.2 markup. Unchanged by B2.0.
    expect(lineItems[0]!.unit_price).toBe(72);
    expect(lineItems[0]!.assumed).toBe(true);
  });

  it("labels a contractor's confirmed price as contractor, not system-generated", () => {
    const { lineItems } = compileDraftToLineItems(
      [material("Finishing plaster", 6000)],
      ctx({
        known_material_prices: [
          { description: "Finishing plaster", unit: "bag", unit_price: 41.5 },
        ],
      }),
      [],
      [],
    );
    // The distinction the customer-facing document needs: a figure this
    // contractor has confirmed is not the same as one the model produced.
    expect(lineItems[0]!.provenance?.source).toBe("contractor");
    expect(lineItems[0]!.unit_price).toBe(41.5);
  });

  it("labels the contractor's own rates on a labour line", () => {
    const { lineItems } = compileDraftToLineItems(
      [
        {
          kind: "labour",
          description: "Plastering labour",
          overtime: false,
          people: [{ ref: "Me", days: 2 }],
          includes_tasks: [],
        },
      ],
      ctx({
        team_members: [
          { id: "tm_1", name: "Me", role: "Owner", day_rate: 250 },
        ],
      }),
      [],
      [],
    );
    expect(lineItems[0]!.provenance?.source).toBe("contractor");
  });

  it("labels a provisional sum as system-generated — invented by definition", () => {
    const { lineItems } = compileDraftToLineItems(
      [
        {
          kind: "provisional",
          description: "Provisional sum for materials",
          suggested_amount_pence: 40000,
          reason: "Allowance pending supplier quote",
        },
      ],
      ctx(),
      [],
      [],
    );
    expect(lineItems[0]!.provenance?.source).toBe("system-generated");
    expect(lineItems[0]!.provisional).toBe(true);
  });

  it("labels a customer-supplied material, whose zero is our rule", () => {
    const { lineItems } = compileDraftToLineItems(
      [
        {
          kind: "material",
          description: "Tiles",
          quantity: 10,
          unit: "m2",
          supplied_by: "customer",
          estimated_unit_cost_pence: 0,
        },
      ],
      ctx(),
      [],
      [],
    );
    expect(lineItems[0]!.provenance?.source).toBe("system-generated");
  });

  it("labels a refused material on a first run", () => {
    const { lineItems } = compileDraftToLineItems(
      [material("Finishing plaster", 6000)],
      ctx({ has_pricing_history: false }),
      [],
      [],
    );
    expect(lineItems[0]!.unpriced).toBe(true);
    expect(lineItems[0]!.provenance?.source).toBe("system-generated");
  });

  it("leaves nothing unlabelled across a mixed draft with no extraction", () => {
    // The invariant, stated once: with no stated prices there is no refusal
    // path, so EVERY line out of the compiler carries a source.
    const { lineItems } = compileDraftToLineItems(
      [
        {
          kind: "labour",
          description: "Plastering labour",
          overtime: false,
          people: [{ ref: "Me", days: 3 }],
          includes_tasks: [],
        },
        material("Finishing plaster", 6000),
        {
          kind: "provisional",
          description: "Provisional sum",
          suggested_amount_pence: 40000,
          reason: "Allowance",
        },
      ],
      ctx({
        team_members: [
          { id: "tm_1", name: "Me", role: "Owner", day_rate: 250 },
        ],
      }),
      [],
      [],
    );

    const unlabelled = lineItems.filter((line) => !line.provenance?.source);
    expect(unlabelled.map((l) => l.description)).toEqual([]);
  });
});
