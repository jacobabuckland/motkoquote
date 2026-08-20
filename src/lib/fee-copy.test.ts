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

describe("paidJobFeeLine — accrued (manual mark-paid) reports, never promises", () => {
  // The load-bearing case. An accrued fee was NOT taken out of the payment
  // (there was no payment to take it from), and no rail currently collects it.
  // The line states the amount and its status — the same wording the fees
  // statement uses — so the trade sees on the job the fee the mark-as-paid
  // sheet already told them about. It must not promise a collection.
  const accrued = {
    feeStatus: "accrued",
    feeAmountPennies: 200,
    feeWaivedReason: null,
    freeJobsRemaining: 0,
  };

  it("states the stored amount and that it is outstanding", () => {
    expect(paidJobFeeLine(accrued)).toBe(
      "Motko fee £2.00 — outstanding, not taken from this payment.",
    );
  });

  it("makes no claim that anything was deducted from this payment", () => {
    const line = paidJobFeeLine(accrued) ?? "";
    expect(line).toContain("not taken from this payment");
    expect(line).not.toContain("taken at payment");
    expect(line).not.toContain("taken out of the payment");
  });

  it("promises no collection — no future tense, no schedule, no date", () => {
    const line = paidJobFeeLine(accrued) ?? "";
    for (const promise of ["we'll", "we will", "collect", "scheduled", "next month", "due"]) {
      expect(line.toLowerCase()).not.toContain(promise);
    }
  });

  // The three surfaces that mention this one fee must agree: the mark-as-paid
  // sheet says a fee applies, the job says it is outstanding, and Settings
  // lists it under "Outstanding — not taken at source". Same fee, same status.
  it("agrees with the mark-as-paid sheet that a fee applies to this job", () => {
    const sheet = markPaidFeeLine({ freeJobsRemaining: 0, quoteTotalPounds: 500 });
    expect(sheet).toContain("£2");
    expect(paidJobFeeLine(accrued)).toContain("£2.00");
  });

  it("uses the same 'outstanding' framing as the fees statement", () => {
    expect(paidJobFeeLine(accrued)).toContain("outstanding");
  });

  it("carries the £4 band through unchanged", () => {
    expect(
      paidJobFeeLine({ ...accrued, feeAmountPennies: 400 }),
    ).toBe("Motko fee £4.00 — outstanding, not taken from this payment.");
  });

  it("says nothing when an accrued row carries no amount", () => {
    expect(paidJobFeeLine({ ...accrued, feeAmountPennies: 0 })).toBeNull();
    expect(paidJobFeeLine({ ...accrued, feeAmountPennies: null })).toBeNull();
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
