import { describe, expect, it } from "vitest";
import { summariseAccruedFees } from "@/lib/fee-statement";

describe("summariseAccruedFees", () => {
  it("returns all zeros when nothing is accrued", () => {
    expect(summariseAccruedFees([])).toEqual({
      grossPennies: 0,
      netPennies: 0,
      vatPennies: 0,
      jobCount: 0,
    });
  });

  it("rolls up gross, net, VAT and the job count", () => {
    const totals = summariseAccruedFees([
      { feeAmountPennies: 200, netPennies: 167, vatPennies: 33 },
      { feeAmountPennies: 400, netPennies: 333, vatPennies: 67 },
      { feeAmountPennies: 200, netPennies: 167, vatPennies: 33 },
    ]);
    expect(totals).toEqual({
      grossPennies: 800,
      netPennies: 667,
      vatPennies: 133,
      jobCount: 3,
    });
    // The summed split still equals the gross owed — never inflated.
    expect(totals.netPennies + totals.vatPennies).toBe(totals.grossPennies);
  });
});
