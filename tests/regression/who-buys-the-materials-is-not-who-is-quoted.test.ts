/**
 * Scenario 41 zeroed both materials because the intake read "customer prices"
 * as "the customer supplies them".
 *
 * The contractor said, in one breath:
 *
 *   "I need 10 bags of finish. Sorry, make that 8 bags. They are GBP 12 each,
 *    not GBP 11. 8 at GBP 12 is the final figure. One primer tub at GBP 25 as
 *    well. THESE ARE CUSTOMER PRICES before VAT with no markup."
 *
 * `materials_supply.responsibility` came back "customer". Every layer below
 * then behaved correctly on a wrong premise: the materials were marked
 * customer-supplied, held at GBP 0 by the rule of 19 Sep, and the quote came
 * out at GBP 250 against GBP 371.
 *
 * "Customer price" is a trade idiom for the SELL price -- what the customer is
 * charged, as against trade or cost price. It is a statement about pricing and
 * says the contractor is supplying, not the reverse.
 *
 * TWO THINGS WERE WRONG, AND ONLY ONE OF THEM IS 41.
 *
 * 1. The intake schema described `responsibility` as who "supplies" the
 *    materials, a word that reads straight onto "customer ... prices". It now
 *    asks who BUYS, and says outright that a pricing phrase is not an answer.
 *    That is where 41's defect is, and a prompt is not a thing a test can pin,
 *    so nothing here asserts on it.
 *
 *    It was not enough on its own. Three identical replays after that change
 *    landed all still came back customer-supplied, so the idiom is now read
 *    deterministically as well -- see the SUPERSEDED note below, and
 *    a-customer-price-is-a-price-not-a-supply.test.ts for the reader itself.
 *
 * 2. `reconcileMaterialsSupply` -- the #826 guard that exists to catch exactly
 *    this, wrong ownership capture -- was INERT on most jobs. It read only the
 *    itemised arrays, and the intake schema says in as many words to itemise
 *    "on a SPLIT only" and leave them empty otherwise. So a contractor saying
 *    "I'll bring all the materials myself" over a captured
 *    `responsibility: "customer"` changed nothing at all. That is what this
 *    file pins, and it is the same inert-guard shape #842 found in the same
 *    field: the arrays are the exception, `responsibility` is the answer.
 */

import { describe, expect, it } from "vitest";
import { reconcileMaterialsSupply } from "@/lib/voice/materials-ownership";
import type { MaterialsSupply } from "@/lib/schemas/job";

/** A job that itemised nothing, which is what the intake schema asks for. */
const captured = (responsibility: "contractor" | "customer"): MaterialsSupply =>
  ({
    contractor_supplied: [],
    customer_supplied: [],
    responsibility,
  }) as unknown as MaterialsSupply;

const settle = (responsibility: "contractor" | "customer", transcript: string) => {
  const { supply, changes } = reconcileMaterialsSupply(captured(responsibility), transcript);
  return {
    responsibility: (supply as unknown as { responsibility?: string }).responsibility,
    changes,
  };
};

describe("a whole-job claim reaches a job that itemised nothing", () => {
  it("corrects a captured customer when the contractor says they bring it all", () => {
    const { responsibility, changes } = settle(
      "customer",
      "Eight bags of finish. I'll bring all the materials myself.",
    );

    expect(responsibility).toBe("contractor");
    expect(changes).toHaveLength(1);
  });

  it("corrects a captured contractor when the contractor says the customer does", () => {
    const { responsibility } = settle(
      "contractor",
      "Eight bags of finish. The customer is supplying the materials.",
    );

    expect(responsibility).toBe("customer");
  });

  it("quotes back what the contractor actually said, whole", () => {
    // The verb alternation matched "supply" inside "supplying", so the
    // contractor was quoted as having said "The customer is supply".
    const { changes } = settle("contractor", "The customer is supplying everything.");

    expect(changes[0]?.because).toBe("The customer is supplying");
  });

  it("takes the last claim, so a correction beats what it corrects", () => {
    const { responsibility } = settle(
      "contractor",
      "I'll supply everything. Actually the customer already bought the lot.",
    );

    expect(responsibility).toBe("customer");
  });
});

describe("what it will not move, because the words do not say so", () => {
  it("leaves a bare price alone — a figure is not a claim about supply", () => {
    const { responsibility, changes } = settle(
      "customer",
      "8 at £12 is the final figure. One primer tub at £25 as well.",
    );

    // A contractor can say what customer-supplied materials cost, and often
    // does. Nothing here is a supply claim, so the capture stands.
    expect(responsibility).toBe("customer");
    expect(changes).toEqual([]);
  });

  // SUPERSEDED, deliberately. This case used to carry scenario 41's closing
  // sentence -- "these are customer prices before VAT with no markup" -- and
  // asserted the capture stood, on the grounds that correcting it needed the
  // intake to capture it right. #845 made that attempt, rewriting the schema to
  // ask who BUYS; three identical replays after it landed all still came back
  // customer-supplied, at £250 against £371.
  //
  // So the idiom is now read here too, and the assertion above is split in two:
  // the bare price still moves nothing, which was the part worth keeping, and
  // the idiom moves the job, which is the part that was wrong. The reader and
  // everything it refuses live in
  // tests/regression/a-customer-price-is-a-price-not-a-supply.test.ts.
  it("reads the pricing idiom — scenario 41's own sentence", () => {
    const { responsibility, changes } = settle(
      "customer",
      "8 at £12 is the final figure. One primer tub at £25 as well. " +
        "These are customer prices before VAT with no markup.",
    );

    expect(responsibility).toBe("contractor");
    expect(changes).toHaveLength(1);
  });

  it("leaves a claim that names one material, with nothing itemised to move", () => {
    const { responsibility } = settle("customer", "I'll bring the finish.");

    expect(responsibility).toBe("customer");
  });

  it("does not read a claim about a cost item as a claim about materials", () => {
    // "On me" claims whatever came BEFORE it. Matching a whole-job word
    // anywhere after it read all three of these as the contractor buying every
    // material on the job -- and the second one says the opposite outright.
    for (const said of [
      "Waste removal is on me and no other materials are needed.",
      "The skip is on me, the customer has all the materials already.",
      "Parking is on me for all of it.",
    ]) {
      expect(settle("customer", said).responsibility, said).toBe("customer");
    }
  });

  it("invents nothing where responsibility was never captured", () => {
    const nothing = { contractor_supplied: [], customer_supplied: [] } as MaterialsSupply;
    const { changes } = reconcileMaterialsSupply(nothing, "I'll bring all the materials.");

    expect(changes).toEqual([]);
  });

  it("leaves a job with no claim in it entirely alone", () => {
    const { responsibility, changes } = settle(
      "contractor",
      "Eight bags of finish and a tub of primer.",
    );

    expect(responsibility).toBe("contractor");
    expect(changes).toEqual([]);
  });
});
