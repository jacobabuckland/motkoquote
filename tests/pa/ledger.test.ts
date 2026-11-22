import { describe, expect, it } from "vitest";
import { owedInPounds } from "@/lib/pa/ledger";

describe("owedInPounds", () => {
  it("turns the money position's pence into pounds", () => {
    // £1,840.00 owed is 184000 pence. Treating it as pounds read £184,000.
    expect(owedInPounds([{ totalOwed: 184_000 }])).toBe(1840);
  });

  it("adds customers up in pence before converting, so no rounding creeps in", () => {
    expect(owedInPounds([{ totalOwed: 10_050 }, { totalOwed: 5 }, { totalOwed: 1 }])).toBe(100.56);
  });

  it("is nothing when nobody owes anything", () => {
    expect(owedInPounds([])).toBe(0);
  });
});
