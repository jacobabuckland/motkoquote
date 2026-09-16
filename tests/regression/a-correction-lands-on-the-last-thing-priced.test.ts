/**
 * "Actually, no, £48" corrects what was just said — not what was said first.
 *
 * #771 made a correction with no item of its own join the nearest PRECEDING
 * group, and fixed the case where the items were in separate sentences. It left
 * the commoner one: `position` is the SENTENCE index, so every item priced in
 * one breath shares it, every distance ties, and the tie fell through to
 * creation order — the first item priced won, which is exactly the answer #771
 * was written to stop.
 *
 * TR30's canary is that shape. One sentence pricing four things, then a
 * one-figure correction. The correction superseded the FIRST item, so it reached
 * the quote unpriced, and the item actually being corrected kept the figure the
 * contractor had just withdrawn. The canary gate stopped the batch before any
 * of the 30 scored cases ran.
 *
 * The second half is the same event seen from the other end: a correction names
 * nothing, so joining a group has to give it that group's item. Emitted with a
 * null item it matches no line, lands as an "Unspecified item" provisional, and
 * raises "you said £48.00 ... but it isn't on any line of this quote".
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const live = (transcript: string) =>
  extractStatedPrices(transcript).filter((p) => p.superseded_by === null);

const priceFor = (transcript: string, item: string) =>
  live(transcript).find((p) => p.item?.toLowerCase().includes(item));

// Four items priced in a single sentence, then a bare correction. The figures
// are per-unit and flat, mixed, because the canary's were.
const ONE_BREATH =
  "Three rolls of membrane at £18 each, two tubs of adhesive at £22 each, " +
  "one skip at £310, collection is £75. Sorry, no, £55.";

describe("a correction after several prices in one sentence", () => {
  it("does not touch the first thing priced", () => {
    const membrane = priceFor(ONE_BREATH, "membrane");

    expect(membrane, "the first item must still carry its own price").toBeDefined();
    expect(membrane?.amount).toBe(1800);
    expect(membrane?.quantity).toBe(3);
  });

  it("leaves everything else in the sentence alone too", () => {
    expect(priceFor(ONE_BREATH, "adhesive")?.amount).toBe(2200);
    expect(priceFor(ONE_BREATH, "skip")?.amount).toBe(31000);
  });

  it("corrects the last thing priced", () => {
    const collection = priceFor(ONE_BREATH, "collection");

    expect(collection?.amount, "£75 was withdrawn and £55 replaces it").toBe(5500);
  });

  it("marks the withdrawn figure superseded rather than dropping it", () => {
    const withdrawn = extractStatedPrices(ONE_BREATH).find((p) => p.amount === 7500);

    expect(withdrawn?.superseded_by).toBe(5500);
  });

  it("leaves no priced amount with nothing to attach to", () => {
    // An amount with a null item reaches the quote as an "Unspecified item"
    // provisional and a flag saying it is on no line — the visible half of this
    // defect, and the reason the canary's £48 went missing twice over.
    expect(live(ONE_BREATH).filter((p) => p.item === null)).toEqual([]);
  });
});

describe("a correction across sentences, which #771 already covered", () => {
  const ACROSS =
    "Twenty-eight bags of finish at £11.20 each. Delivery is £60. Actually, no, £48.";

  it("still reaches back to the nearest sentence, not the earliest", () => {
    expect(priceFor(ACROSS, "finish")?.amount, "the finish keeps its own rate").toBe(1120);
    expect(priceFor(ACROSS, "delivery")?.amount).toBe(4800);
  });
});

describe("a correction with nothing before it", () => {
  it("is left unattached rather than reaching forward past an item", () => {
    // Nothing precedes, so the forward branch applies. It must not silently
    // adopt the first item it can see — a figure spoken before any item was
    // named is not a correction of that item.
    const stray = extractStatedPrices("No, £48. The collection is £75.");

    expect(stray.find((p) => p.item?.includes("collection"))?.amount).toBe(7500);
  });
});

describe("what the contractor actually sees on the quote", () => {
  // The extractor is where the defect lives, but the canary gate reads line
  // items -- so the claim is worth making where it was made against us.
  const context = (): CompileContext => ({
    day_rate: 250,
    overtime_rate: null,
    markup_pct: 0,
    team_members: [],
    rate_cards: [],
    known_material_prices: [],
    owner_label: "Jake",
    has_pricing_history: false,
    labour_plan: { people_count: 1, duration_days: 1, crew_description: null },
  });

  const material = (description: string, quantity = 1): DraftLineItem =>
    ({
      kind: "material",
      description,
      quantity,
      unit: "sum",
      supplied_by: "contractor",
      estimated_unit_cost_pence: 1000,
    }) as DraftLineItem;

  const compiled = compileDraftToLineItems(
    [material("Membrane rolls", 3), material("Waste collection")],
    context(),
    [],
    extractStatedPrices(ONE_BREATH, []),
  );

  const line = (description: string) =>
    compiled.lineItems.find((i) => i.description === description);

  it("charges the corrected figure, not the withdrawn one", () => {
    expect(lineItemTotal(line("Waste collection")!)).toBe(55);
  });

  it("leaves the first line priced at what was said about it", () => {
    const membrane = line("Membrane rolls")!;

    expect(membrane.unpriced ?? false, "this is the row the canary found at £0").toBe(false);
    expect(lineItemTotal(membrane)).toBe(54);
  });
});
