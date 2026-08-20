import { describe, expect, it } from "vitest";
import { markPaidFeeLine, paidJobFeeLine } from "@/lib/fee-copy";

describe("markPaidFeeLine", () => {
  it("shows the free-job line while allowance remains", () => {
    expect(markPaidFeeLine({ freeJobsRemaining: 1, quoteTotalPounds: 500 })).toBe(
      "This is one of your free jobs — no fee.",
    );
  });

  it("shows the £2 band at or below the £1,000 threshold", () => {
    expect(markPaidFeeLine({ freeJobsRemaining: 0, quoteTotalPounds: 1000 })).toBe(
      "A £2 Motko fee applies to this job.",
    );
  });

  it("shows the £4 band above the £1,000 threshold", () => {
    expect(markPaidFeeLine({ freeJobsRemaining: 0, quoteTotalPounds: 1001 })).toBe(
      "A £4 Motko fee applies to this job.",
    );
  });

  // This sheet marks an OFF-RAILS payment (cash, bank transfer). Nothing is
  // deducted from it, so the copy must not claim the fee comes out of the
  // payment — that wording belongs to the Stripe path only.
  it("never claims the fee is taken out of the payment", () => {
    const line = markPaidFeeLine({ freeJobsRemaining: 0, quoteTotalPounds: 500 });
    expect(line).not.toContain("taken out of the payment");
    expect(line).not.toContain("taken at payment");
  });

  it("is always shown — there is no flag that hides it", () => {
    expect(markPaidFeeLine({ freeJobsRemaining: 0, quoteTotalPounds: 500 })).toBeTruthy();
    expect(markPaidFeeLine({ freeJobsRemaining: 3, quoteTotalPounds: 500 })).toBeTruthy();
  });
});

describe("paidJobFeeLine — waived by the free allowance", () => {
  it("names the free job and the balance left", () => {
    expect(
      paidJobFeeLine({
        feeStatus: "not_applicable",
        feeAmountPennies: 0,
        feeWaivedReason: "free_allowance",
        freeJobsRemaining: 3,
      }),
    ).toBe("Paid in full. This was one of your free jobs — 3 left.");
  });

  it("reads the balance through to zero on the last free job", () => {
    expect(
      paidJobFeeLine({
        feeStatus: "not_applicable",
        feeAmountPennies: 0,
        feeWaivedReason: "free_allowance",
        freeJobsRemaining: 0,
      }),
    ).toBe("Paid in full. This was one of your free jobs — 0 left.");
  });

  it("never reports a negative balance if the cache has drifted below zero", () => {
    expect(
      paidJobFeeLine({
        feeStatus: "not_applicable",
        feeAmountPennies: 0,
        feeWaivedReason: "free_allowance",
        freeJobsRemaining: -2,
      }),
    ).toBe("Paid in full. This was one of your free jobs — 0 left.");
  });
});

describe("paidJobFeeLine — collected at source", () => {
  it("states the stored £2 fee, not a recomputation", () => {
    expect(
      paidJobFeeLine({
        feeStatus: "collected",
        feeAmountPennies: 200,
        feeWaivedReason: null,
        freeJobsRemaining: 0,
      }),
    ).toBe("Paid in full. Motko fee £2.00 (incl. VAT) taken at payment.");
  });

  it("states the stored £4 fee", () => {
    expect(
      paidJobFeeLine({
        feeStatus: "collected",
        feeAmountPennies: 400,
        feeWaivedReason: null,
        freeJobsRemaining: 0,
      }),
    ).toBe("Paid in full. Motko fee £4.00 (incl. VAT) taken at payment.");
  });

  // The bands can change. A job's line must reflect what was actually taken
  // from that payment, so an amount matching no current band still renders.
  it("renders a stored amount that matches no current band", () => {
    expect(
      paidJobFeeLine({
        feeStatus: "collected",
        feeAmountPennies: 300,
        feeWaivedReason: null,
        freeJobsRemaining: 0,
      }),
    ).toBe("Paid in full. Motko fee £3.00 (incl. VAT) taken at payment.");
  });

  it("says nothing when 'collected' carries a zero amount", () => {
    expect(
      paidJobFeeLine({
        feeStatus: "collected",
        feeAmountPennies: 0,
        feeWaivedReason: null,
        freeJobsRemaining: 0,
      }),
    ).toBeNull();
  });
});

describe("paidJobFeeLine — accrued (manual mark-paid) claims nothing", () => {
  // The load-bearing case. An accrued fee was NOT taken out of the payment
  // (there was no payment to take it from), and nothing collects it — PAY-5
  // removed the rail. Both a deduction claim and a collection promise would be
  // false, so the line renders nothing at all.
  const accrued = {
    feeStatus: "accrued",
    feeAmountPennies: 200,
    feeWaivedReason: null,
    freeJobsRemaining: 0,
  };

  it("renders no line for an accrued fee", () => {
    expect(paidJobFeeLine(accrued)).toBeNull();
  });

  it("makes no deduction claim and no promise to collect", () => {
    const line = paidJobFeeLine(accrued) ?? "";
    expect(line).not.toContain("taken");
    expect(line).not.toContain("collect");
    expect(line).not.toContain("£2");
  });
});

describe("paidJobFeeLine — nothing to say", () => {
  it("renders nothing for a legacy job with no fee columns written", () => {
    expect(
      paidJobFeeLine({
        feeStatus: null,
        feeAmountPennies: null,
        feeWaivedReason: null,
        freeJobsRemaining: 4,
      }),
    ).toBeNull();
  });

  it("renders nothing for a refund-waived job", () => {
    expect(
      paidJobFeeLine({
        feeStatus: "waived_refund",
        feeAmountPennies: 200,
        feeWaivedReason: null,
        freeJobsRemaining: 0,
      }),
    ).toBeNull();
  });
});
