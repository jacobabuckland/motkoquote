import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { paidJobFeeLine } from "@/lib/fee-copy";

// The paid state's fee line. The copy decisions themselves are covered
// exhaustively in src/lib/fee-copy.test.ts against the pure function; this file
// covers the two things that live on the PAGE and cannot be asserted there:
//
//   1. the job query actually selects the stored fee columns, and
//   2. the page feeds those stored columns in, rather than recomputing a fee.
//
// These are wiring assertions over the page source rather than a mount. The job
// page is a large async server component (Supabase, six joined reads, costs and
// P&L actions); mounting it would assert far more about the mocks than about
// the fee line. The behaviour under test is the pure function, which is mounted
// nowhere and tested directly.

const pageSource = readFileSync(resolve(__dirname, "page.tsx"), "utf-8");

describe("job page wires the stored fee into the paid state", () => {
  it("selects all three fee columns on the job", () => {
    for (const column of ["fee_amount_pennies", "fee_status", "fee_waived_reason"]) {
      expect(pageSource).toContain(column);
    }
  });

  it("builds the line from paidJobFeeLine", () => {
    expect(pageSource).toMatch(/from\s+["']@\/lib\/fee-copy["']/);
    expect(pageSource).toContain("paidJobFeeLine({");
  });

  it("never recomputes the fee from the bands on this page", () => {
    // The stored fee is the record of what actually happened at settlement. A
    // recomputation would silently rewrite history the first time a band moves.
    expect(pageSource).not.toContain("motkoFeePennies");
    expect(pageSource).not.toMatch(/from\s+["']@\/lib\/motko-fee["']/);
  });

  it("renders the line in the paid branch only when there is one", () => {
    expect(pageSource).toContain("paidFeeLine &&");
    expect(pageSource).toContain('data-testid="paid-fee-line"');
  });
});

// A paid job's three real outcomes, asserted end to end through the same call
// the page makes — so the page's contract with the copy module is pinned, not
// just the module's internals.
describe("the three outcomes a contractor can land on", () => {
  it("a waived job names the free job and the remaining count", () => {
    const line = paidJobFeeLine({
      feeStatus: "not_applicable",
      feeAmountPennies: 0,
      feeWaivedReason: "free_allowance",
      freeJobsRemaining: 3,
    });
    expect(line).toBe("Paid in full. This was one of your free jobs — 3 left.");
  });

  it("a charged job states the amount that actually left the payment", () => {
    const line = paidJobFeeLine({
      feeStatus: "collected",
      feeAmountPennies: 400,
      feeWaivedReason: null,
      freeJobsRemaining: 0,
    });
    expect(line).toBe("Paid in full. Motko fee £4.00 (incl. VAT) taken at payment.");
  });

  it("an accrued job neither claims a deduction nor promises a collection", () => {
    const line = paidJobFeeLine({
      feeStatus: "accrued",
      feeAmountPennies: 200,
      feeWaivedReason: null,
      freeJobsRemaining: 0,
    });
    expect(line).toBeNull();
  });
});
