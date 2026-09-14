/**
 * @vitest-environment happy-dom
 */

// £1,080 was contractually owed and appeared on no screen in the app.
//
// Reported 13 Sep. A £1,440 job took a 25% deposit — £360.00 — which settled.
// The balance had not been invoiced, so it was in no open invoice, so the
// dashboard's ledger figure was £0 and the hero read:
//
//     You're all square
//     Every invoice you've sent has been paid. Nothing outstanding.
//
// The first sentence was true. The second was not. The £1,080 existed only on
// the PDF the customer holds, which is the wrong way round — the person who is
// owed the money should not be the last to know about it.
//
// The ledger figure itself is NOT changed. It sums open invoices, which is
// exactly right for "what am I waiting to be paid", and an uninvoiced balance
// is not a receivable: the customer has been asked for nothing and owes nothing
// yet. Adding it would inflate the largest number in the product with money
// nobody has requested. So it lives in the zero state, as the reason the
// contractor is not actually finished.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { totalUninvoicedBalance, uninvoicedBalance } from "@/lib/uninvoiced-balance";

afterEach(cleanup);

/** The reported job: £1,440 agreed, £360 deposit raised, contract signed. */
const REPORTED = {
  total: 1440,
  invoices: [{ amount: 360 }],
  contractSigned: true,
};

describe("the reported job", () => {
  it("has a balance of £1,080", () => {
    expect(uninvoicedBalance(REPORTED)).toBe(1080);
  });

  it("says so on the dashboard instead of 'Nothing outstanding'", () => {
    render(<DashboardHero outstandingTotal={0} uninvoicedTotal={1080} />);

    expect(screen.getByText(/£1,080\.00 of agreed work hasn't been invoiced yet/i)).toBeDefined();
    expect(screen.queryByText(/Nothing outstanding/i)).toBeNull();
  });

  it("still says every invoice is paid, because that part was true", () => {
    render(<DashboardHero outstandingTotal={0} uninvoicedTotal={1080} />);

    expect(screen.getByText(/Every invoice is paid/i)).toBeDefined();
  });
});

describe("the ledger figure is untouched", () => {
  it("shows the outstanding total when there is one, uninvoiced work or not", () => {
    render(<DashboardHero outstandingTotal={1080} uninvoicedTotal={500} />);

    // The receivable, alone and large. The uninvoiced figure must not be added
    // to it and must not replace it.
    expect(screen.getByText("£1,080.00")).toBeDefined();
    expect(screen.queryByText(/hasn't been invoiced yet/i)).toBeNull();
  });

  it("leaves the genuine all-square state exactly as it was", () => {
    render(<DashboardHero outstandingTotal={0} uninvoicedTotal={0} />);

    expect(screen.getByText(/You're all square/i)).toBeDefined();
    expect(screen.getByText(/Nothing outstanding/i)).toBeDefined();
  });

  it("defaults to the all-square state when no balance is supplied", () => {
    render(<DashboardHero outstandingTotal={0} />);

    expect(screen.getByText(/You're all square/i)).toBeDefined();
  });
});

describe("what counts as a balance", () => {
  it("is nothing until the contract is signed", () => {
    // An accepted quote with no signed contract is still editable and still
    // withdrawable (#727 decision 1), so calling it a balance would claim
    // something the customer has not committed to.
    expect(uninvoicedBalance({ ...REPORTED, contractSigned: false })).toBe(0);
  });

  it("is nothing once the job is fully invoiced", () => {
    expect(
      uninvoicedBalance({ total: 1440, invoices: [{ amount: 360 }, { amount: 1080 }], contractSigned: true }),
    ).toBe(0);
  });

  it("counts an invoice that has been raised but not paid", () => {
    // Raised-and-unpaid is already in the ledger figure as a receivable. It
    // must not be counted twice.
    expect(
      uninvoicedBalance({ total: 1440, invoices: [{ amount: 1440 }], contractSigned: true }),
    ).toBe(0);
  });

  it("is the whole total when nothing has been invoiced at all", () => {
    expect(uninvoicedBalance({ total: 1440, invoices: [], contractSigned: true })).toBe(1440);
  });

  it("never goes negative when more was invoiced than quoted", () => {
    // A variation or a correction. Not this function's business, and a
    // negative would silently reduce another job's balance.
    expect(
      uninvoicedBalance({ total: 1000, invoices: [{ amount: 1200 }], contractSigned: true }),
    ).toBe(0);
  });
});

describe("across the whole dashboard", () => {
  it("sums every job's balance", () => {
    expect(
      totalUninvoicedBalance([
        REPORTED,
        { total: 500, invoices: [], contractSigned: true },
        { total: 900, invoices: [], contractSigned: false },
      ]),
    ).toBe(1580);
  });

  it("is zero with no jobs", () => {
    expect(totalUninvoicedBalance([])).toBe(0);
  });

  it("stays exact to the penny", () => {
    expect(
      totalUninvoicedBalance([
        { total: 100.1, invoices: [{ amount: 33.37 }], contractSigned: true },
        { total: 0.03, invoices: [], contractSigned: true },
      ]),
    ).toBe(66.76);
  });
});
