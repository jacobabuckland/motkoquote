/**
 * Scenario 302 billed GBP 600 of finish after the contractor asked for the
 * price to be left.
 *
 * Every guard behaved. The GBP 60/bag came from `known_material_prices` -- a
 * price this contractor had confirmed on an earlier job -- and a confirmed
 * price is exactly what #839 says may be charged, because it is theirs rather
 * than an invention. The refusal #839 built only ever covered the model's own
 * estimates, so nothing downstream of the confirmed-price branch could hold it.
 *
 * It is still the wrong answer. A price on file is what this contractor
 * charged LAST time; an instruction in the call is what they want THIS time,
 * and a default that overrides a current instruction is not a default. Jacob's
 * call, 20 Sep: an explicit instruction outranks a saved price, and the saved
 * figure comes back as a suggestion to confirm.
 *
 * THE DIRECTION OF ERROR IS INVERTED HERE, and the reader is looser because of
 * it. Reading a deferral that was not there leaves a line unpriced with the
 * figure offered beside it: the contractor confirms it, nobody is overcharged,
 * and the quote cannot be sent until they look. MISSING one charges money the
 * contractor said not to charge yet.
 */

import { describe, expect, it } from "vitest";
import {
  compileDraftToLineItems,
  PRICE_DEFERRED_PREFIX,
  type CompileContext,
} from "@/lib/compile-draft";
import { extractPricingDeferrals } from "@/lib/voice/pricing-deferrals";
import type { DraftLineItem } from "@/lib/schemas/job";
import type { TranscriptTurn } from "@/lib/voice-transcript";

const ON_FILE = [{ description: "Finishing plaster", unit: "bag", unit_price: 60 }];

const drafts: DraftLineItem[] = [
  {
    kind: "material",
    description: "Finishing plaster (multi-finish)",
    quantity: 10,
    unit: "bag",
    estimated_unit_cost_pence: 6000,
    supplied_by: "contractor",
  },
];

const compile = (transcript: string, over: Partial<CompileContext> = {}) => {
  const ctx: CompileContext = {
    day_rate: 250,
    overtime_rate: null,
    markup_pct: 0,
    team_members: [],
    rate_cards: [],
    known_material_prices: ON_FILE,
    owner_label: "Owner",
    has_pricing_history: true,
    labour_plan: null,
    contractor_said: transcript,
    pricing_deferrals: extractPricingDeferrals(transcript).map((d) => d.transcript_span),
    ...over,
  };
  return compileDraftToLineItems(drafts, ctx, [], [], []);
};

const finishLine = (transcript: string) =>
  compile(transcript).lineItems.find((l) => l.description.includes("Finishing"))!;

const SAID_LEAVE_IT =
  "Ten bags of finishing plaster. Do not price the finish yet, I will confirm it.";
const SAID_NOTHING = "Ten bags of finishing plaster. That is everything.";

describe("an instruction in this call outranks a price from an earlier one", () => {
  it("leaves the material unpriced despite a confirmed price on file", () => {
    const line = finishLine(SAID_LEAVE_IT);

    // GBP 600 was the defect: 10 bags at the saved GBP 60.
    expect(line.quantity * line.unit_price).toBe(0);
    expect(line.unpriced).toBe(true);
  });

  it("keeps the line and its count — only the price is held back", () => {
    const line = finishLine(SAID_LEAVE_IT);

    expect(line.quantity).toBe(10);
    expect(line.unit).toBe("bag");
  });

  it("offers the figure on file back rather than sending them to find one", () => {
    const flag =
      compile(SAID_LEAVE_IT).contractorFlags.find((f) => f.startsWith(PRICE_DEFERRED_PREFIX)) ?? "";

    expect(flag).toContain("£60.00");
    expect(flag).toMatch(/before/i);
    expect(flag).toContain("Do not price the finish yet");
  });

  it("does not tell them nothing confirmed gives a price, because something does", () => {
    // #839's wording is for an invented estimate. Using it here would be false.
    const flags = compile(SAID_LEAVE_IT).contractorFlags.filter((f) =>
      f.includes("Finishing plaster (multi-finish)"),
    );

    expect(flags).toHaveLength(1);
    expect(flags[0]!.startsWith(PRICE_DEFERRED_PREFIX)).toBe(true);
  });
});

describe("a saved price is still a price where nothing was said", () => {
  it("prices from the confirmed figure when no deferral was spoken", () => {
    const line = finishLine(SAID_NOTHING);

    expect(line.unit_price).toBe(60);
    expect(line.quantity * line.unit_price).toBe(600);
    expect(line.unpriced).toBeUndefined();
  });

  it("drops nothing when the caller passes no deferrals at all", () => {
    const line = compile(SAID_NOTHING, { pricing_deferrals: null }).lineItems.find((l) =>
      l.description.includes("Finishing"),
    )!;

    expect(line.unit_price).toBe(60);
  });
});

describe("what the reader counts as declining to price", () => {
  const spans = (t: string) => extractPricingDeferrals(t).length;

  it("reads the forms a trade actually uses", () => {
    for (const said of [
      "Do not price the finish yet.",
      "Leave the price on the plaster for now.",
      "Price it up later.",
      "I will confirm the price before we send.",
      "I need to check the price on the finish.",
      "I dont know the price yet.",
      "Finish price to be confirmed.",
      "The finish is not priced yet.",
    ]) {
      expect(spans(said), said).toBeGreaterThan(0);
    }
  });

  it("does not read a sentence that states a price as declining to state one", () => {
    for (const said of [
      "The finish is twelve pounds a bag.",
      "Eight bags of finish at twelve pounds each.",
      "The price is ninety six pounds for the lot.",
      "Just save the draft, do not send it.",
      "No other materials, waste charge, or extras.",
    ]) {
      expect(spans(said), said).toBe(0);
    }
  });

  it("does not read an uncertain amount as a deferral", () => {
    // "About twelve quid" is a hedged PRICE, refused where the amount is read.
    expect(spans("I think it is about twelve quid a bag.")).toBe(0);
  });

  it("counts only what the contractor said, never the assistant", () => {
    const turn = (speaker: TranscriptTurn["speaker"], text: string, at: string): TranscriptTurn =>
      ({ speaker, text, at });

    // An assistant offering to leave the prices would otherwise unprice a
    // quote nobody asked to leave -- #832's lesson, with more at stake.
    const read = extractPricingDeferrals("unused when turns are valid", [
      turn("contractor", "Ten bags of finishing plaster.", "2026-09-20T14:00:01Z"),
      turn("assistant", "Shall I leave the prices for now?", "2026-09-20T14:00:02Z"),
    ]);

    expect(read).toEqual([]);
  });
});

describe("which lines a deferral reaches", () => {
  const two: DraftLineItem[] = [
    ...drafts,
    {
      kind: "material",
      description: "Primer",
      quantity: 1,
      unit: "tub",
      estimated_unit_cost_pence: 2500,
      supplied_by: "contractor",
    },
  ];

  const compileTwo = (transcript: string) =>
    compileDraftToLineItems(
      two,
      {
        day_rate: 250,
        overtime_rate: null,
        markup_pct: 0,
        team_members: [],
        rate_cards: [],
        known_material_prices: ON_FILE,
        owner_label: "Owner",
        has_pricing_history: true,
        labour_plan: null,
        contractor_said: transcript,
        pricing_deferrals: extractPricingDeferrals(transcript).map((d) => d.transcript_span),
      },
      [],
      [],
      [],
    );

  it("reaches only the material a deferral names", () => {
    const said =
      "Ten bags of finishing plaster and a tub of primer. Do not price the finish yet.";
    const deferred = compileTwo(said).contractorFlags.filter((f) =>
      f.startsWith(PRICE_DEFERRED_PREFIX),
    );

    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toContain("Finishing plaster");
  });

  it("reaches every material when the deferral names none", () => {
    // "Leave the prices for now" is about the job, not one thing in it.
    const said = "Ten bags of finishing plaster and a tub of primer. Leave the prices for now.";
    const deferred = compileTwo(said).contractorFlags.filter((f) =>
      f.startsWith(PRICE_DEFERRED_PREFIX),
    );

    expect(deferred).toHaveLength(2);
  });

  it("quotes the sentence that named the material, not one that reached it", () => {
    const said =
      "Ten bags of finishing plaster and a tub of primer. Leave the prices for now. " +
      "Do not price the finish yet.";
    const flag = compileTwo(said).contractorFlags.find(
      (f) => f.startsWith(PRICE_DEFERRED_PREFIX) && f.includes("Finishing plaster"),
    )!;

    expect(flag).toContain("Do not price the finish yet");
  });
});
