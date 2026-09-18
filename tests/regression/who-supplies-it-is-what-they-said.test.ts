/**
 * "I'll bring both" means the contractor brings both.
 *
 * On job 1d6389a8 the contractor said, in one breath:
 *
 *   "6 bags of finish at £11.50 each, 1 tub of primer at 27, I'll bring both"
 *
 * and `materials_supply` recorded BOTH as customer-supplied. The drafter then
 * rendered that faithfully, and the quote told the customer they were buying
 * materials the contractor was buying. Nothing downstream could catch it: every
 * layer below was working correctly on a wrong premise, so the correction has
 * to happen between the capture and everything that reads it.
 *
 * The remit is narrow on purpose. This acts on EXPLICIT statements and nothing
 * else — it is enforceable, repeatable handling of what was said plainly, not
 * an understanding of every phrasing. Where the words do not settle it, the
 * captured value stands and the uncertainty survives to a surface that can ask.
 */

import { describe, expect, it } from "vitest";
import type { MaterialsSupply } from "@/lib/schemas/job";
import {
  ownershipChangeFlag,
  reconcileMaterialsSupply,
} from "@/lib/voice/materials-ownership";

const supply = (
  contractor: string[],
  customer: string[],
  responsibility?: MaterialsSupply["responsibility"],
): MaterialsSupply => ({
  contractor_supplied: contractor,
  customer_supplied: customer,
  ...(responsibility ? { responsibility } : {}),
});

const after = (captured: MaterialsSupply, said: string | null) =>
  reconcileMaterialsSupply(captured, said);

describe("scenario 48, the job this exists for", () => {
  // The captured entries are free text as the model wrote them, prices and all.
  const CAPTURED = supply(
    ["Protection", "Cleaning"],
    ["6 bags of Finish at £11.50 each", "1 tub of Primer at £27"],
    "split",
  );
  const SAID = "6 bags of finish at 11.50 each, 1 tub of primer at 27, I'll bring both";

  it("moves both materials to the contractor", () => {
    const { supply: result } = after(CAPTURED, SAID);

    expect(result.customer_supplied).toEqual([]);
    expect(result.contractor_supplied).toContain("6 bags of Finish at £11.50 each");
    expect(result.contractor_supplied).toContain("1 tub of Primer at £27");
  });

  it("leaves the materials the contractor already had", () => {
    const { supply: result } = after(CAPTURED, SAID);

    expect(result.contractor_supplied).toContain("Protection");
    expect(result.contractor_supplied).toContain("Cleaning");
  });

  it("says what it changed and which words changed it", () => {
    const { changes } = after(CAPTURED, SAID);

    expect(changes).toHaveLength(2);
    expect(changes[0]?.from).toBe("customer");
    expect(changes[0]?.to).toBe("contractor");
    expect(changes[0]?.because.toLowerCase()).toContain("i'll bring");

    const flag = ownershipChangeFlag(changes[0]!);
    expect(flag).toContain("was recorded as customer-supplied");
    expect(flag).toContain("Change it back on the line if that is wrong");
  });
});

describe("what does NOT establish ownership", () => {
  it("leaves 'I need' alone, which is scenario 41", () => {
    // A trade says "I need" about materials they are buying and about materials
    // being left on site for them, in the same tone. Turning it into a rule
    // would be guessing consistently, which is worse than not guessing.
    const captured = supply([], ["Finish", "Primer tub"], "split");
    const { supply: result, changes } = after(
      captured,
      "I need eight bags of finish and a primer tub. Those are customer prices.",
    );

    expect(changes).toEqual([]);
    expect(result).toEqual(captured);
  });

  it("leaves talk that names no material alone", () => {
    const captured = supply([], ["Finish"], "customer");
    const { changes } = after(captured, "I'll bring my tools and I'll get there at eight.");

    expect(changes).toEqual([]);
  });

  it("changes nothing without a transcript", () => {
    const captured = supply([], ["Finish"], "customer");

    expect(after(captured, "").changes).toEqual([]);
    expect(after(captured, null).supply).toEqual(captured);
  });
});

describe("mixed supply is preserved", () => {
  it("moves only the material the words name", () => {
    const { supply: result } = after(
      supply([], ["Finish", "Primer tub"], "customer"),
      "I'll bring the finish. The customer is supplying the primer.",
    );

    expect(result.contractor_supplied).toEqual(["Finish"]);
    expect(result.customer_supplied).toEqual(["Primer tub"]);
    expect(result.responsibility).toBe("split");
  });
});

describe("corrections and negation", () => {
  it("lets a correction inside one sentence win", () => {
    const { supply: result, changes } = after(
      supply(["Finish"], [], "contractor"),
      "I'll supply the finish, actually the customer already bought it.",
    );

    expect(result.customer_supplied).toEqual(["Finish"]);
    expect(changes[0]?.because.toLowerCase()).toContain("customer already bought");
  });

  it("lets a correction in the next sentence win", () => {
    const { supply: result } = after(
      supply([], ["Finish"], "customer"),
      "The customer is supplying the finish. Actually no, I'll bring it.",
    );

    expect(result.contractor_supplied).toEqual(["Finish"]);
  });
});

describe("where the words do not settle it, uncertainty survives", () => {
  it("refuses a singular 'it' that could mean either of two materials", () => {
    // Ambiguous to a person too. Guessing here is exactly what this is not for.
    const captured = supply([], ["Finish", "Primer"], "customer");
    const { changes } = after(
      captured,
      "The customer is supplying the finish and the primer. Actually I'll bring it.",
    );

    expect(changes).toEqual([]);
  });

  it("still reaches both on a plural", () => {
    const { supply: result } = after(
      supply([], ["Finish", "Primer"], "customer"),
      "The customer is supplying the finish and the primer. Actually I'll bring both.",
    );

    expect(result.contractor_supplied).toEqual(["Finish", "Primer"]);
    expect(result.customer_supplied).toEqual([]);
  });
});

describe("the overall responsibility field", () => {
  it("is left untouched when nothing moved", () => {
    const captured = supply([], ["Finish"], "customer");

    expect(after(captured, "I need the finish.").supply.responsibility).toBe("customer");
  });

  it("is restated only from what the lists now say", () => {
    const { supply: result } = after(
      supply([], ["Finish"], "customer"),
      "I'll bring the finish.",
    );

    expect(result.responsibility).toBe("contractor");
  });
});
