/**
 * "These are customer prices" is a statement about pricing. Scenario 41 read it
 * as a statement about supply, three replays running.
 *
 * The contractor's closing sentence was
 *
 *   "These are customer prices before VAT with no markup."
 *
 * and intake came back `materials_supply.responsibility: "customer"`. Both
 * materials were then marked customer-supplied, held at GBP 0 by this app's
 * rule for a material the customer buys, and the quote went out at GBP 250
 * against GBP 371.
 *
 * #845 rewrote the intake schema to ask who BUYS and to say in as many words
 * that a pricing phrase is not an answer. That is the right fix and it is not a
 * guaranteed one -- a prompt is a request, and three identical replays after it
 * landed all still came back customer-supplied. This is the part that does not
 * depend on the model reading its instructions.
 *
 * FOUR THINGS THIS DELIBERATELY DOES NOT DO, each with a test below.
 *
 *  1. It does not read a PRICE as proof of supply. A contractor can say what
 *     customer-supplied materials cost -- "the customer's getting the bags,
 *     they're about twelve quid" is an ordinary sentence and it means the
 *     customer supplies them. Only the idiom moves anything, never a figure.
 *  2. It does not overrule a plain statement of supply. An explicit "the
 *     customer is supplying the materials" stands, whatever else was said.
 *  3. It does not pick a side when the contractor said both. That is handed
 *     back as a question, with both halves quoted, and nothing is changed.
 *  4. It does not read the assistant's half of the call. Motko asks "and are
 *     those customer prices?" in the ordinary course of an intake, and reading
 *     the transcript whole would take its own question as the answer.
 */

import { describe, expect, it } from "vitest";
import {
  ownershipConflictFlag,
  reconcileMaterialsSupply,
} from "@/lib/voice/materials-ownership";
import { statedCustomerPrices } from "@/lib/voice/customer-price-idiom";
import type { MaterialsSupply } from "@/lib/schemas/job";
import type { TranscriptTurn } from "@/lib/voice-transcript";

/** A job that itemised nothing, which is what the intake schema asks for. */
const captured = (responsibility: "contractor" | "customer" | null): MaterialsSupply =>
  ({
    contractor_supplied: [],
    customer_supplied: [],
    ...(responsibility === null ? {} : { responsibility }),
  }) as unknown as MaterialsSupply;

const settle = (
  responsibility: "contractor" | "customer" | null,
  transcript: string,
  turns?: TranscriptTurn[],
) => {
  const { supply, changes, unresolved } = reconcileMaterialsSupply(
    captured(responsibility),
    transcript,
    turns,
  );
  return {
    responsibility: (supply as unknown as { responsibility?: string }).responsibility,
    changes,
    unresolved,
  };
};

/** Scenario 41's closing sentence, as the contractor said it. */
const FORTY_ONE =
  "I need 10 bags of finish. Sorry, make that 8 bags. They are £12 each, not £11. " +
  "8 at £12 is the final figure. One primer tub at £25 as well. " +
  "These are customer prices before VAT with no markup.";

describe("the idiom is recognised", () => {
  it("corrects scenario 41's captured customer to contractor", () => {
    const { responsibility, changes } = settle("customer", FORTY_ONE);

    expect(responsibility).toBe("contractor");
    expect(changes).toHaveLength(1);
  });

  it("quotes the words that moved it, so the contractor can disagree", () => {
    const { changes } = settle("customer", FORTY_ONE);

    expect(changes[0]?.because.toLowerCase()).toBe("customer prices");
    expect(changes[0]?.from).toBe("customer");
    expect(changes[0]?.to).toBe("contractor");
  });

  it.each([
    "These are customer prices.",
    "That's the customer price, before VAT.",
    "Customer rates, not trade.",
    "That's the customer-price for the lot.",
    "That's the price to the customer.",
    "That's what the customer pays.",
  ])("reads %s as the pricing idiom", (sentence) => {
    expect(statedCustomerPrices(sentence)).not.toBeNull();
    expect(settle("customer", `Eight bags of finish. ${sentence}`).responsibility).toBe(
      "contractor",
    );
  });
});

describe("a stated price is not proof of supply", () => {
  it.each([
    "The bags are £12 each and the primer is £25.",
    "Twelve pounds a bag, twenty five for the tub.",
    "It's £96 for the materials.",
  ])("leaves the capture alone on %s", (sentence) => {
    expect(statedCustomerPrices(sentence)).toBeNull();
    expect(settle("customer", `Eight bags of finish. ${sentence}`).responsibility).toBe(
      "customer",
    );
  });

  it("does not read a price the customer is paying as a customer price", () => {
    // The idiom is the word governing a PRICE NOUN. "The customer's paying for
    // the bags" is about who pays and is not this phrase.
    expect(statedCustomerPrices("The customer's paying for the bags.")).toBeNull();
  });

  it.each([
    "The materials are customer supplied.",
    "The customer's materials are already on site.",
    "That's a customer-supplied job.",
  ])("does not mistake a supply phrase for the pricing idiom on %s", (sentence) => {
    expect(statedCustomerPrices(sentence)).toBeNull();
  });
});

describe("an explicit instruction outranks the idiom", () => {
  it("leaves a whole-job customer claim standing and asks about it", () => {
    const { responsibility, changes, unresolved } = settle(
      "customer",
      "The customer is supplying all the materials. These are customer prices, mind.",
    );

    expect(responsibility).toBe("customer");
    expect(changes).toHaveLength(0);
    expect(unresolved).toHaveLength(1);
  });

  it("leaves a claim naming one material standing too", () => {
    // Not a whole-job claim, so it settles nothing on its own -- but it is
    // still the contractor saying the customer buys something, and the idiom
    // does not get to move the job over the top of it.
    const { responsibility, changes, unresolved } = settle(
      "customer",
      "The customer is buying the finish. These are customer prices.",
    );

    expect(responsibility).toBe("customer");
    expect(changes).toHaveLength(0);
    expect(unresolved).toHaveLength(1);
  });

  it("quotes both halves in the flag, and decides neither", () => {
    const { unresolved } = settle(
      "customer",
      "The customer is supplying all the materials. These are customer prices, mind.",
    );
    const flag = ownershipConflictFlag(unresolved[0]!);

    expect(flag).toContain("customer is supplying");
    expect(flag.toLowerCase()).toContain("customer prices");
    // It asks. It does not announce a change, because none was made.
    expect(flag).toMatch(/unclear|check/i);
    expect(flag).not.toMatch(/corrected|is now/i);
  });

  it("raises no conflict where the contractor only priced", () => {
    expect(settle("customer", FORTY_ONE).unresolved).toHaveLength(0);
  });

  it("still lets an explicit contractor claim correct the job", () => {
    // The claim is doing the work here, not the idiom -- the idiom is absent.
    const { responsibility } = settle(
      "customer",
      "The customer is supplying the materials. Actually no, I'll bring all the materials myself.",
    );

    expect(responsibility).toBe("contractor");
  });

  it("quotes the last customer claim when a correction restates it", () => {
    const { unresolved } = settle(
      "customer",
      "These are customer prices. Actually the customer already bought the lot.",
    );

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.supplyClaim).toMatch(/already bought/i);
  });
});

describe("the idiom only ever moves the safe direction", () => {
  it("never moves a captured contractor to customer", () => {
    const { responsibility, changes } = settle("contractor", FORTY_ONE);

    expect(responsibility).toBe("contractor");
    expect(changes).toHaveLength(0);
  });

  it("never answers a question intake left unanswered", () => {
    // Nothing captured is an open question, not a wrong capture. Filling it in
    // from an idiom would be inventing an answer, which is the one thing this
    // module exists not to do.
    const { responsibility, changes } = settle(null, FORTY_ONE);

    expect(responsibility).toBeUndefined();
    expect(changes).toHaveLength(0);
  });

  // SUPERSEDED. This case asserted that an itemised split is left alone, on
  // the reasoning that a contractor who itemised has already said who buys
  // what. That premise belongs to the CAPTURE, not to the contractor: three
  // replays of 41 after this reader shipped came back as an itemised "split"
  // -- two of them with both materials on the customer -- on a call where the
  // contractor made no claim about supply at all. The reader was inert on the
  // exact shape it was written for.
  it("reaches an itemised split the contractor never itemised", () => {
    const split = {
      contractor_supplied: ["1 tub of primer"],
      customer_supplied: ["8 bags of finish"],
      responsibility: "split",
    } as unknown as MaterialsSupply;

    const { supply, changes } = reconcileMaterialsSupply(split, FORTY_ONE);

    expect(supply.customer_supplied).toEqual([]);
    expect(supply.contractor_supplied).toContain("8 bags of finish");
    expect(changes).toHaveLength(1);
  });

  it("stands down on an itemised job where the contractor DID speak to supply", () => {
    // One claim anywhere means they addressed it. The idiom does not get to
    // finish the sentence for them, so the primer they never mentioned keeps
    // whatever intake recorded.
    const split = {
      contractor_supplied: [],
      customer_supplied: ["8 bags of finish", "1 tub of primer"],
      responsibility: "customer",
    } as unknown as MaterialsSupply;

    const { supply } = reconcileMaterialsSupply(
      split,
      "I'll bring the 8 bags of finish. These are customer prices.",
    );

    expect(supply.contractor_supplied).toEqual(["8 bags of finish"]);
    expect(supply.customer_supplied).toEqual(["1 tub of primer"]);
  });
});

describe("only the contractor's half of the call is read", () => {
  // `at` is not decoration: `turnsAreValid` requires it on every turn, and a
  // call whose turns lack it falls back to the flat transcript -- which is the
  // opposite of what each test below is checking.
  const turns = (...rows: [TranscriptTurn["speaker"], string][]): TranscriptTurn[] =>
    rows.map(([speaker, text], index) => ({
      speaker,
      text,
      at: `2026-09-20T10:0${index}:00.000Z`,
    }));

  const call = turns(
    ["assistant", "And are those customer prices, or trade?"],
    ["contractor", "Eight bags of finish, twelve pounds a bag."],
  );

  it("does not take Motko's own question as the contractor's answer", () => {
    const flat = call.map((turn) => turn.text).join(" ");

    // Read whole, the idiom is right there in the transcript.
    expect(statedCustomerPrices(flat)).not.toBeNull();
    // Read as a call, it was the assistant's word and moves nothing.
    expect(settle("customer", flat, call).responsibility).toBe("customer");
  });

  it("does not take a customer claim in Motko's mouth as a conflict", () => {
    const withIdiom = turns(
      ["assistant", "So the customer is supplying the materials?"],
      ["contractor", "No. Eight bags of finish. These are customer prices."],
    );
    const flat = withIdiom.map((turn) => turn.text).join(" ");
    const said = settle("customer", flat, withIdiom);

    expect(said.unresolved).toHaveLength(0);
    expect(said.responsibility).toBe("contractor");
  });

  it("acts on the idiom when the contractor is the one who said it", () => {
    const mine = turns(
      ["assistant", "And how many bags?"],
      ["contractor", "Eight bags of finish. These are customer prices."],
    );

    expect(settle("customer", "ignored", mine).responsibility).toBe("contractor");
  });

  it("falls back to the flat transcript when the call carries no turns", () => {
    // Most of the corpus predates speaker labels, and a guard that goes silent
    // on those calls is a guard that does not run.
    expect(settle("customer", FORTY_ONE, undefined).responsibility).toBe("contractor");
  });
});
