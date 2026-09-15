/**
 * A correction supersedes the price it was spoken about, not an earlier one.
 *
 * An amount stated with no item of its own — "Actually, no, £48" — is adopted
 * by a nearby priced item and treated as a correction of it. Which item was
 * decided by whichever group happened to be created FIRST inside the window,
 * and a correction is spoken after several things have already been priced, so
 * it reached back past the item actually being corrected. Voice run 20 said:
 *
 *   "…28 bags of finish at £11.20 each."   → item "finish",   position 0
 *   "Delivery is £60."                     → item "Delivery", position 1
 *   "Actually, no, £48."                   → no item,         position 2
 *
 * The £48 landed on "finish", superseding a price that had been captured
 * exactly right — finish reached the quote at £0 — while delivery was charged
 * at the £60 the contractor had just corrected, with nothing flagged. Both of
 * that run's material findings were this one branch.
 *
 * A correction refers to what was said most recently.
 */

import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const RUN_20 =
  "We're supplying 28 bags of finish at £11.20 each. Delivery is £60. Actually, no, £48.";

describe("a correction lands on the price it corrects", () => {
  it("supersedes the nearest preceding price, not the earliest one in range", () => {
    const prices = extractStatedPrices(RUN_20, []);

    const delivery = prices.find((p) => p.amount === 6000);
    expect(delivery?.superseded_by, "£60 delivery was corrected to £48").toBe(4800);
  });

  it("leaves a correctly captured price alone", () => {
    const prices = extractStatedPrices(RUN_20, []);

    const finish = prices.find((p) => p.amount === 1120);
    expect(finish, "£11.20 a bag was stated and must survive").toBeDefined();
    expect(
      finish?.superseded_by,
      "nothing was said about the finish price after it was given",
    ).toBeNull();
  });

  it("still corrects the only item in play, when there is only one", () => {
    // The shape #418 froze: one item, restated. Adoption by proximity must not
    // cost the ordinary correction.
    const prices = extractStatedPrices(
      "Consumer unit labour will be four eighty... actually, make that five twenty for the consumer unit.",
      [],
    );

    expect(prices.find((p) => p.amount === 48000)?.superseded_by).toBe(52000);
    expect(prices.find((p) => p.amount === 52000)?.superseded_by).toBeNull();
  });
});
