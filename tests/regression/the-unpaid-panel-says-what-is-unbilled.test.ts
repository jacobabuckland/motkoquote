// 18 SEP: the dashboard disagreed with itself about whether anything was left
// to do.
//
// "ACCEPTED QUOTES AWAITING INVOICE" listed three jobs, each saying "Mark the
// work complete to raise the final invoice", and a few inches below it:
//
//     UNPAID INVOICES
//     No outstanding invoices
//     Every invoice you've sent has been paid.
//
// The sentence is literally true — every invoice that exists is settled — and
// it is still the wrong sentence, because in a panel a contractor scans for
// what they are owed it reads as "you are all square".
//
// This is the defect fixed in the HERO on 13 Sep (uninvoiced-balance.ts records
// it: a £1,440 job whose £360 deposit settled, £1,080 agreed and on no screen).
// The hero learned to say so; this section kept the old copy. One fix, two
// surfaces, and only one of them got it.
//
// The assertions below are on the SENTENCE BUILDER rather than a rendered page,
// because the claim is about what the words assert, and the figure is the whole
// of it.
import { describe, expect, it } from "vitest";
import {
  totalUninvoicedBalance,
  uninvoicedBalance,
  unpaidInvoicesEmptyDescription,
} from "@/lib/uninvoiced-balance";

// The reported shape: pass-15's two jobs, both signed, both part-invoiced.
const alpha = {
  total: 1800,
  invoices: [{ amount: 600 }], // deposit paid, £1,200 never billed
  contractSigned: true,
};

const bravo = {
  total: 1320,
  invoices: [{ amount: 330 }], // deposit paid, £990 never billed
  contractSigned: true,
};

describe("what the dashboard knows it has not billed", () => {
  it("counts agreed work that no invoice has asked for", () => {
    expect(uninvoicedBalance(alpha)).toBe(1200);
    expect(uninvoicedBalance(bravo)).toBe(990);
  });

  it("totals it across the board, which is the figure the panel must name", () => {
    // £2,190 sitting behind "Every invoice you've sent has been paid."
    expect(totalUninvoicedBalance([alpha, bravo])).toBe(2190);
  });

  it("is silent when there is genuinely nothing left to bill", () => {
    // The case where the original sentence is the right one, unchanged.
    const settled = { total: 1800, invoices: [{ amount: 1800 }], contractSigned: true };

    expect(totalUninvoicedBalance([settled])).toBe(0);
  });

  it("claims nothing on a quote whose contract is not signed", () => {
    // Deliberate and narrow: an accepted quote with no signature is not money
    // owed, because #727 leaves it editable and withdrawable. Counting it would
    // put a figure on the dashboard the customer has not committed to.
    expect(uninvoicedBalance({ ...alpha, contractSigned: false })).toBe(0);
  });

  it("never returns a negative, so a variation cannot eat another job's balance", () => {
    const overInvoiced = { total: 1000, invoices: [{ amount: 1200 }], contractSigned: true };

    expect(uninvoicedBalance(overInvoiced)).toBe(0);
    expect(totalUninvoicedBalance([overInvoiced, bravo])).toBe(990);
  });
});

describe("the sentence the panel renders", () => {
  // The REAL exported function the dashboard calls, not a copy of its
  // conditional. An earlier draft of this file re-implemented the ternary here,
  // which would have gone on passing if the page reverted to the old copy —
  // a test that cannot fail for the reason it exists.
  it("names the unbilled figure rather than implying there is none", () => {
    expect(unpaidInvoicesEmptyDescription(2190)).toContain(
      "£2,190.00 of agreed work hasn't been invoiced yet",
    );
  });

  it("keeps the plain sentence when the contractor really is all square", () => {
    expect(unpaidInvoicesEmptyDescription(0)).toBe("Every invoice you've sent has been paid.");
  });

  it("never drops the true half of the claim", () => {
    // Every invoice IS paid, and that was never wrong — it is the omission
    // after it that misled. Both sentences stand together.
    expect(unpaidInvoicesEmptyDescription(2190)).toContain(
      "Every invoice you've sent has been paid.",
    );
  });

  it("reads the figure straight off the balance derivation", () => {
    // End to end: two part-invoiced jobs in, one sentence out.
    expect(unpaidInvoicesEmptyDescription(totalUninvoicedBalance([alpha, bravo]))).toBe(
      "Every invoice you've sent has been paid. £2,190.00 of agreed work hasn't been invoiced yet.",
    );
  });
});
