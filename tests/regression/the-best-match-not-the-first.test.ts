/**
 * Two deliveries, both priced out loud, both shipped at £0.00.
 *
 * Found on motko.app on 20 Sep. The job page's SCOPE block read "One material
 * delivery at £65 / Delivery at £48" and its QUOTE block, three cards below,
 * read "Material delivery £0.00 / Delivery £0.00" — and the statement of work
 * the customer receives printed the £65 and the £48 for a quote charging
 * neither.
 *
 * NOTHING WAS WRONG WITH THE EXTRACTION. All three figures come out of the
 * transcript correctly, self-correction included:
 *
 *     material delivery = 6500 · delivery = 6000 · delivery = 4800
 *
 * The loss is at the join. `describesItem` matches when one name sits inside
 * the other, so `Delivery` matched the £65's item `material delivery` as well
 * as its own £48 — and `matchStatedPriceByItem` returned the FIRST match, so
 * both lines claimed the £65. Pass 1 saw two claimants and refused, which is
 * right on what it was told, and the £48 was never considered by anything
 * because the scan had already returned.
 *
 * Ranking the match instead of taking the first is what these assert: each
 * price goes to the line that names it best, and an ambiguity that was an
 * artefact of scan order stops being one.
 */
import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { extractStatedPrices } from "@/lib/voice/stated-prices";
import { extractStatedQuantities } from "@/lib/voice/stated-quantities";
import { contractorSaid } from "@/lib/voice/contractor-said";
import type { DraftLineItem } from "@/lib/schemas/job";

const TRANSCRIPT =
  "Skip hire for one skip at £340. one material delivery at £65, and delivery at £60, " +
  "actually, no, £48.";

const drafts: DraftLineItem[] = [
  {
    kind: "material",
    description: "Skip hire – one skip",
    quantity: 1,
    unit: "skip",
    estimated_unit_cost_pence: 34000,
    supplied_by: "contractor",
  },
  {
    kind: "material",
    description: "Material delivery",
    quantity: 1,
    unit: "delivery",
    estimated_unit_cost_pence: 13000,
    supplied_by: "contractor",
  },
  {
    kind: "material",
    description: "Delivery",
    quantity: 1,
    unit: "delivery",
    estimated_unit_cost_pence: 13000,
    supplied_by: "contractor",
  },
];

const ctx = (transcript: string): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 0,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
  labour_plan: { people_count: 1, duration_days: 1, crew_description: "just me" },
  contractor_said: contractorSaid(transcript),
});

const compile = (transcript: string, lines: DraftLineItem[]) =>
  compileDraftToLineItems(
    lines,
    ctx(transcript),
    [],
    extractStatedPrices(transcript),
    extractStatedQuantities(transcript),
  );

const priceOf = (transcript: string, lines: DraftLineItem[], description: string) =>
  compile(transcript, lines).lineItems.find((l) => l.description === description)?.unit_price;

describe("a name inside another name", () => {
  it("charges the delivery the contractor priced at £65", () => {
    expect(priceOf(TRANSCRIPT, drafts, "Material delivery")).toBe(65);
  });

  it("charges the other one at the figure that superseded £60", () => {
    expect(priceOf(TRANSCRIPT, drafts, "Delivery")).toBe(48);
  });

  it("stops reporting a stated price as absent when its line is right there", () => {
    // The guard reporting its own failure: "you said £48.00 … but it isn't on
    // any line of this quote", beside a line called Delivery.
    const flags = compile(TRANSCRIPT, drafts).contractorFlags;

    expect(flags.filter((f) => f.startsWith("Not on any line:"))).toEqual([]);
  });

  it("stops offering to guess a price the contractor already gave", () => {
    const flags = compile(TRANSCRIPT, drafts).contractorFlags;

    expect(flags.filter((f) => f.startsWith("Not priced:"))).toEqual([]);
  });
});

describe("what must not move", () => {
  it("leaves a line nobody priced unpriced, rather than reaching for a neighbour", () => {
    // The refusal of 19 Sep is the rule this change must not weaken: an
    // unconfirmed material is never charged. Only the JOIN is being fixed.
    const unsaid = [
      drafts[0]!,
      { ...drafts[1]!, description: "Scaffold tower hire" },
    ];

    expect(priceOf("Skip hire for one skip at £340.", unsaid, "Scaffold tower hire")).toBe(0);
  });

  it("still prices a line whose name matches exactly", () => {
    expect(priceOf(TRANSCRIPT, drafts, "Skip hire – one skip")).toBe(340);
  });

  it("does not let one line's price reach a differently named line", () => {
    // The whole point of the change, stated as the thing it must never do:
    // the skip's £340 belongs to the skip. Asserted alongside the deliveries
    // because a rule that binds prices more eagerly is exactly the rule that
    // could start binding them to the wrong line.
    const out = compile(TRANSCRIPT, drafts);
    const deliveries = out.lineItems.filter((l) => l.description.includes("elivery"));

    expect(deliveries.map((l) => l.unit_price)).toEqual([65, 48]);
  });
});
