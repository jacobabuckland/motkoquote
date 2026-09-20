/**
 * Scenario 303 of the 19 Sep tranche carried a GBP 60 line for "scrim tape and
 * general consumables (corner beads, gauging water, sandpaper)" on a job where
 * the contractor had named their plaster and said "no other materials".
 *
 * Jacob decided this on 16 Sep: the drafting model may not add lines the
 * contractor never mentioned. The TENDENCIES road was closed then, and it
 * works -- scenario 303's own flags carry "past jobs have included a PVA
 * bonding agent line, not added here as it wasn't mentioned for this job".
 * The scrim tape sat beside that flag, because the model does not need a
 * tendency to invent a line and nothing in the drafting prompt forbids it.
 *
 * #839 took the money out of it: an unconfirmed estimate is unpriced now, so
 * the GBP 60 is already gone and no total can move either way. What it did not
 * do is take the LINE off the document. It still reaches the customer as "To
 * be confirmed" -- an open cost for work that is not in the job -- and still
 * blocks the send until the contractor prices or deletes something they never
 * wanted.
 *
 * AND #839 IS ALSO WHY THE COMPILER CANNOT TELL, without being told. An
 * unconfirmed material is unpriced whatever its origin, so the scrim line and
 * the plaster lines beside it are identical in every field the compiler holds:
 * same `unpriced`, same `system-generated` provenance, same absent price. What
 * separates them is not in the draft at all. It is whether the contractor ever
 * said the words.
 */

import { describe, expect, it } from "vitest";
import {
  compileDraftToLineItems,
  describesSomethingSaid,
  UNCONFIRMED_ESTIMATE_PREFIX,
  UNREQUESTED_MATERIAL_PREFIX,
  type CompileContext,
} from "@/lib/compile-draft";
import { contractorSaid } from "@/lib/voice/contractor-said";
import type { DraftLineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import type { TranscriptTurn } from "@/lib/voice-transcript";

/** Scenario 303, in the contractor's own words. */
const SAID =
  "Small wall skim upstairs and downstairs, just me one day at my saved rate. " +
  "Six bags of finish upstairs and four bags of finish downstairs. " +
  "No other materials or extras. Save a draft, do not send it.";

const SCRIM = "Scrim tape and general consumables (corner beads, gauging water, sandpaper)";

const ctx = (over: Partial<CompileContext> = {}): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 100,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
  labour_plan: null,
  contractor_said: SAID,
  ...over,
});

const material = (
  over: Partial<Extract<DraftLineItem, { kind: "material" }>> = {},
): DraftLineItem => ({
  kind: "material",
  description: "Finishing plaster (multi-finish) – upstairs wall skim",
  quantity: 6,
  unit: "bag",
  supplied_by: "contractor",
  estimated_unit_cost_pence: 3000,
  ...over,
});

const scrim = (): DraftLineItem => material({ description: SCRIM, quantity: 1, unit: "lot" });

const compiled = (over: Partial<CompileContext> = {}, drafts?: DraftLineItem[]) =>
  compileDraftToLineItems(drafts ?? [material(), scrim()], ctx(over), [], [], []);

const turn = (speaker: TranscriptTurn["speaker"], text: string, at: string): TranscriptTurn =>
  ({ speaker, text, at });

describe("a material the contractor never mentioned leaves the quote", () => {
  it("removes the consumables line nobody asked for (scenario 303)", () => {
    const kept = compiled().lineItems.map((l) => l.description);

    expect(kept).not.toContain(SCRIM);
  });

  it("keeps the material the contractor did name, unpriced as it is", () => {
    const kept = compiled().lineItems;

    expect(kept).toHaveLength(1);
    expect(kept[0]!.description).toContain("Finishing plaster");
    expect(kept[0]!.unpriced).toBe(true);
  });

  it("says what it removed, rather than deleting it quietly", () => {
    const flag =
      compiled().contractorFlags.find((f) => f.startsWith(UNREQUESTED_MATERIAL_PREFIX)) ?? "";

    expect(flag).toContain("Scrim tape");
    expect(flag).toMatch(/did not mention it/i);
    // The one contractor who would disagree is the one who meant to charge for
    // it, so the flag has to tell them how to get it back.
    expect(flag).toMatch(/add it as a line/i);
  });

  it("does not also tell them to price the line it just removed", () => {
    // Two flags about one line, one saying it is gone and one saying to enter
    // a price for it, is how a flag channel stops being read.
    const flags = compiled().contractorFlags.filter((f) => f.includes("Scrim tape"));

    expect(flags).toHaveLength(1);
    expect(flags[0]!.startsWith(UNCONFIRMED_ESTIMATE_PREFIX)).toBe(false);
  });
});

describe("what it will not touch", () => {
  it("drops nothing when it was handed no words at all", () => {
    // Absent must be the keep-everything branch: a caller that forgets this
    // gets the behaviour from before it existed, never a line lost.
    const kept = compiled({ contractor_said: null }).lineItems.map((l) => l.description);

    expect(kept).toContain(SCRIM);
  });

  it("drops nothing when the words are empty", () => {
    expect(compiled({ contractor_said: "   " }).lineItems).toHaveLength(2);
  });

  it("never touches a PRICED line, however it was described", () => {
    // Priced means somebody confirmed it. Eligibility stops at `unpriced`, so
    // no total this guard sees can move.
    const kept = compiled(
      { known_material_prices: [{ description: SCRIM, unit: "lot", unit_price: 60 }] },
      [scrim()],
    ).lineItems;

    expect(kept).toHaveLength(1);
    expect(kept[0]!.unit_price).toBe(60);
  });

  it("keeps a line carrying a price the contractor stated in the call", () => {
    const statedPrice: StatedPrice = {
      amount: 6000,
      item: "scrim tape",
      quantity: null,
      caps_item: null,
      transcript_span: "sixty quid of scrim tape",
      qualifiers: { each: false, fitted: false, already_paid: false, excluded: false },
      superseded_by: null,
      refused: false,
    };
    const { lineItems } = compileDraftToLineItems([scrim()], ctx(), [], [statedPrice], []);

    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]!.unit_price).toBe(60);
  });

  it("never touches a labour line, which is the job itself", () => {
    const labour: DraftLineItem = {
      kind: "labour",
      description: "Rendering and pebbledash to the gable",
      people: [{ ref: "owner", days: 1 }],
      overtime: false,
      includes_tasks: [],
    };
    const { lineItems } = compileDraftToLineItems([labour], ctx({ day_rate: null }), [], [], []);

    expect(lineItems.some((l) => l.category === "labour")).toBe(true);
  });

  it("leaves a customer-supplied material alone", () => {
    // A real GBP 0 rather than an absent price, so it is not eligible at all.
    const { lineItems } = compileDraftToLineItems(
      [material({ description: SCRIM, supplied_by: "customer" })],
      ctx(),
      [],
      [],
      [],
    );

    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]!.unpriced).toBeUndefined();
  });
});

describe("what counts as having been said", () => {
  it("matches across an inflection the drafting model introduced", () => {
    // The contractor said "finish"; the model wrote "Finishing plaster".
    // Matching exact words would drop a real line on nothing but grammar.
    expect(describesSomethingSaid("Finishing plaster – skim coat", "six bags of finish")).toBe(
      true,
    );
  });

  it("does not match a material sharing no word with the call", () => {
    expect(describesSomethingSaid(SCRIM, SAID)).toBe(false);
  });

  it("treats a line with no distinctive word of its own as unjudged", () => {
    expect(describesSomethingSaid("the job", SAID)).toBe(true);
  });

  it("holds against the real contractor transcript we have (job 7a5bd06d)", () => {
    const real =
      "Quick draft for QA Auto, priced finish. Small wall skim, just me one day at my saved " +
      "rate. I will supply 8 bags of finish at £12 a bag. That is £96 for finish, at before " +
      "VAT. Do not multiply it twice. Preparation and cleaning included. No other materials " +
      "or extras. Dates are not agreed. Save a draft, do not send it.";

    expect(describesSomethingSaid("Finish plaster – for skimming small wall", real)).toBe(true);
    expect(describesSomethingSaid(SCRIM, real)).toBe(false);
  });
});

describe("only the contractor's half of the call is evidence", () => {
  it("does not count a material the assistant introduced", () => {
    // The failure #832 found on counts, in its worst form here: an assistant
    // asking "and the usual consumables?" would be the sentence that
    // authorises the line nobody asked for.
    const said = contractorSaid("unused when turns are valid", [
      turn("contractor", "Six bags of finish upstairs.", "2026-09-19T14:00:01Z"),
      turn("assistant", "And scrim tape and corner beads as usual?", "2026-09-19T14:00:02Z"),
    ]);

    expect(describesSomethingSaid(SCRIM, said)).toBe(false);
    expect(describesSomethingSaid("Finishing plaster – wall skim", said)).toBe(true);
  });

  it("falls back to the flat transcript when turns are absent or legacy-shaped", () => {
    const legacy = [{ speaker: "contractor", text: "six bags of finish" }];

    expect(contractorSaid("six bags of finish", legacy as TranscriptTurn[])).toContain("finish");
    expect(contractorSaid("six bags of finish", null)).toContain("finish");
  });

  it("falls back rather than report silence when no contractor turn survives", () => {
    // Turns we cannot read are not a contractor who said nothing, and silence
    // is exactly what makes the guard fire.
    const said = contractorSaid("six bags of finish upstairs", [
      turn("assistant", "How many bags?", "2026-09-19T14:00:01Z"),
    ]);

    expect(said).toContain("finish");
  });
});
