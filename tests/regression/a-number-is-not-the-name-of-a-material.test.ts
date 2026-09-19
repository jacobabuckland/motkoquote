/**
 * "8 at £12 each" named its item "8".
 *
 * Reproduced against the deployed extractor on 19 Sep while diagnosing
 * scenario 41, which ships £84 short with its finish priced at one bag. The
 * report's diagnosis was "a £12 lump amount with item identity 8, plus a
 * separate £12-each record with no item", and the first half reproduces from
 * ordinary phrasing.
 *
 * Everything downstream keys on that name. `matchStatedPriceByItem` compares
 * it against a line description and `identifySupersessions` groups by it — so
 * a price called "8" attaches to no line, groups with nothing, and the count
 * the contractor said in the same breath is stranded with it.
 *
 * Item-LESS is the honest answer, and it already has a meaning: an amount with
 * no item is adopted into the nearest group by proximity, which is how a
 * correction finds the thing it corrects. A WRONG name cannot be adopted by
 * anything, so it is strictly worse than no name at all.
 */

import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const items = (text: string) => extractStatedPrices(text).map((p) => p.item);

describe("a bare number never becomes an item identity", () => {
  it("leaves the count out of the name it could not supply", () => {
    expect(items("I need 8 bags of finish and a tub of primer. 8 at £12 each")).toEqual([null]);
  });

  it("keeps the amount and its per-unit count, which is what was said", () => {
    const [price] = extractStatedPrices("8 bags of finish. 8 at £12 each");

    expect(price?.amount).toBe(1200);
    expect(price?.qualifiers.each).toBe(true);
  });

  it("does not swallow a real material named beside a number", () => {
    expect(items("Finish and primer. 8 at £12 each. Primer is £25 a tub.")).toContain("Primer");
  });
});

describe("what a real name still does", () => {
  it("names a material stated plainly", () => {
    expect(items("The finish is £12 a bag")).toEqual(["finish"]);
  });

  it("names one that carries a number inside it", () => {
    // "2.5mm twin & earth" is a material whose name contains digits. The rule
    // is that a name may not be ONLY digits, not that digits disqualify it.
    expect(items("Cable is £1.85 a metre")).toEqual(["Cable"]);
  });
});
