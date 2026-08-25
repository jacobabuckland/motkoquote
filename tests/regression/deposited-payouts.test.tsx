/**
 * @vitest-environment happy-dom
 */

// "Deposited" — the second money state.
//
// The complaint was "they made a payment via Stripe and it got marked as paid
// but no monies was received". Both halves were true: the customer had paid,
// and the money had not moved on. "Paid" was the only money state the product
// had, so a trade watching for their money had nothing to watch.
//
// Owner's definition (25 Aug): "Paid when the customer pays and deposited once
// sent to the end user." So this fires on Stripe's `payout.paid`, which means
// SENT — not arrived. `arrival_date` is Stripe's own estimate and BACS can take
// another working day, which is why every assertion below about the state also
// checks the date is with it. A bare "deposited" is the same overclaim as the
// green "Connected ✓" that started this.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PayoutHistorySection } from "@/app/settings/payout-history-section";
import type { ContractorPayout } from "@/app/settings/payout-history-section";

afterEach(cleanup);

const payout = (over: Partial<ContractorPayout> = {}): ContractorPayout => ({
  stripe_payout_id: "po_1",
  amount_pennies: 41250,
  status: "paid",
  arrival_date: "2026-08-27T00:00:00.000Z",
  created_at: "2026-08-25T00:00:00.000Z",
  ...over,
});

describe("a trade with no payouts yet", () => {
  it("says so, rather than leaving a blank a trade has to interpret", () => {
    // "Nothing here" and "this is broken" look identical when the answer is an
    // empty space — which is the failure mode the notification section had.
    render(<PayoutHistorySection payouts={[]} />);
    expect(screen.getByText(/Nothing sent to your bank yet/i)).toBeDefined();
  });

  it("does not imply a payout happened", () => {
    render(<PayoutHistorySection payouts={[]} />);
    expect(screen.queryByText(/Sent /)).toBeNull();
  });
});

describe("the state is never shown without the date", () => {
  it("shows the amount, when it was sent, and when it should arrive", () => {
    render(<PayoutHistorySection payouts={[payout()]} />);

    expect(screen.getByText(/£412\.50/)).toBeDefined();
    const line = screen.getByText(/Sent/).textContent ?? "";
    expect(line).toMatch(/Sent/);
    expect(
      line,
      "'sent' without an arrival estimate reads as 'already in my account'",
    ).toMatch(/with you by/i);
  });

  it("still gives an expectation when Stripe supplied no estimate", () => {
    // arrival_date is nullable. Falling silent here would leave exactly the
    // bare claim this component exists to avoid.
    render(<PayoutHistorySection payouts={[payout({ arrival_date: null })]} />);
    const line = screen.getByText(/Sent/).textContent ?? "";
    expect(line).toMatch(/working day/i);
  });

  it("never claims the money has arrived", () => {
    render(<PayoutHistorySection payouts={[payout()]} />);
    const body = document.body.textContent?.toLowerCase() ?? "";
    for (const overclaim of ["has arrived", "is in your bank", "received"]) {
      expect(
        body,
        `payout.paid means SENT, not arrived: "${overclaim}"`,
      ).not.toContain(overclaim);
    }
  });
});

describe("a failed payout never reads as money received", () => {
  // The same defect pointed the other way, and worse: a trade told they were
  // paid when the payment bounced will not chase it.
  const failed = payout({
    stripe_payout_id: "po_2",
    status: "failed",
    amount_pennies: 9900,
    created_at: "2026-08-24T00:00:00.000Z",
  });

  it("marks it as not gone through", () => {
    render(<PayoutHistorySection payouts={[payout(), failed]} />);
    // Twice, deliberately: once against the row so the amount cannot be read
    // as received, and once as advice at the foot of the section.
    expect(screen.getAllByText(/didn't go through/i).length).toBeGreaterThanOrEqual(1);
  });

  it("tells the trade what to do about it", () => {
    render(<PayoutHistorySection payouts={[payout(), failed]} />);
    expect(screen.getByText(/Check your bank details/i)).toBeDefined();
  });

  it("does not use a failed payout as the headline figure", () => {
    // The headline is the most recent SUCCESSFUL payout. A failed one leading
    // the section is a number a trade reads as money they have.
    render(<PayoutHistorySection payouts={[failed, payout()]} />);
    const headline = screen.getByText(/Sent/).textContent ?? "";
    expect(headline).toContain("25 Aug");
    expect(headline).not.toContain("24 Aug");
  });

  it("shows nothing as received when every payout failed", () => {
    render(<PayoutHistorySection payouts={[failed]} />);
    expect(screen.queryByText(/Sent /)).toBeNull();
    expect(screen.getAllByText(/didn't go through/i).length).toBeGreaterThanOrEqual(1);
  });
});

describe("history beyond the latest", () => {
  it("lists earlier payouts under the headline", () => {
    render(
      <PayoutHistorySection
        payouts={[
          payout(),
          payout({ stripe_payout_id: "po_3", amount_pennies: 12000, created_at: "2026-08-20T00:00:00.000Z" }),
        ]}
      />,
    );
    expect(screen.getByText(/£120\.00/)).toBeDefined();
  });

  it("shows no history list when there is only one payout", () => {
    render(<PayoutHistorySection payouts={[payout()]} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});
