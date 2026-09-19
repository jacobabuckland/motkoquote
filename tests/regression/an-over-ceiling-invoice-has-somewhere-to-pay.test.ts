// 19 SEP: a contractor who onboarded through Stripe Connect and left the manual
// payout form alone could send an invoice their customer had no way to pay.
//
// The state is not a corner. `syncStripeAccountStatus` auto-populates the payout
// columns from Stripe when Connect completes, and Stripe never returns a full
// account number, so it writes:
//
//     update.payout_account_number = null;      // only last4 is available
//     update.payout_details_complete = true;    // "complete" anyway
//
// That is the DEFAULT state for a Connect-onboarded trade. `hasManualBankDetails`
// needs all three columns, so it is false — and above the £10,000 Pay by Bank
// ceiling the rail cannot take the payment either.
//
// What the customer got: tap Pay -> "exceeds the online payment limit, please use
// bank transfer" -> revealTransfer() -> /api/invoices/[id]/transfer-details 404s
// on the same missing columns -> "couldn't load the bank details, please contact
// <trade> to pay". The page named a payment method and then could not supply it.
//
// Two guards, at the two points that matter: the invoice is refused at creation,
// while the contractor can still fix it; and any invoice already sent says so
// once, up front, instead of sending the customer round that loop.
import { describe, expect, it } from "vitest";
import { buildPayPanel, hasManualBankDetails, type PayPanelInput } from "@/app/i/[id]/pay-panel";

/** Connect complete, manual form never filled — what the sync leaves behind. */
const connectOnly: PayPanelInput = {
  railsAvailable: true,
  payoutDetailsComplete: true, // the flag the sync sets regardless
  accountHolderName: "Acme Plastering Ltd", // Stripe supplies these two
  sortCode: "123456",
  accountNumber: null, // Stripe never supplies this one
  companyName: "Acme Plastering Ltd",
  firstName: "Sam",
  amount: 12_500,
  invoiceId: "a1b2c3d4-e5f6-4000-8000-000000000001",
  stripePayoutsEnabled: true,
  stripeRequirementsDue: false,
};

describe("the state Stripe onboarding actually leaves behind", () => {
  it("is not 'has bank details', whatever payout_details_complete says", () => {
    // The whole defect in one assertion: the flag says complete, the details
    // are not. Every consumer pairs the two for exactly this reason.
    expect(connectOnly.payoutDetailsComplete).toBe(true);
    expect(hasManualBankDetails(connectOnly)).toBe(false);
  });
});

describe("an invoice the button cannot take", () => {
  it("does not offer a button that will refuse it", () => {
    const panel = buildPayPanel(connectOnly);

    expect(
      panel.mode,
      "a pay button above the ceiling sends the customer to bank details that 404",
    ).not.toBe("button_only");
  });

  it("tells the customer to contact the trade, which is the only thing that works", () => {
    expect(buildPayPanel(connectOnly).mode).toBe("setup_incomplete");
  });

  it("does NOT say the same for a rails outage under the ceiling", () => {
    // The line this fix deliberately does not cross, and the first draft of it
    // did. An outage is transient: the trade's setup is fine and the button can
    // succeed on a retry, so "hasn't finished setting up payments" would be a
    // false statement about a real business on their own customer's screen.
    // CONN-6 was right about this case; it was only wrong about the ceiling.
    const outage = { ...connectOnly, amount: 5_000, railsAvailable: false };

    expect(buildPayPanel(outage).mode).toBe("button_only");
  });
});

describe("what must still work", () => {
  it("still takes an under-ceiling payment on the rail", () => {
    // The common case, and the one that must not regress: a Connect-onboarded
    // trade with no manual details is perfectly payable below the ceiling.
    const ordinary = { ...connectOnly, amount: 5_000 };

    expect(buildPayPanel(ordinary).mode).toBe("button_only");
  });

  it("still shows transfer details over the ceiling when they exist", () => {
    // A trade who filled the manual form is unaffected: £12,500 falls to the
    // bank-transfer block exactly as before.
    const withDetails = { ...connectOnly, accountNumber: "12345678" };
    const panel = buildPayPanel(withDetails);

    if (panel.mode !== "transfer_only") throw new Error(`expected transfer_only, got ${panel.mode}`);
    expect(panel.transfer.accountNumber).toBe("12345678");
    expect(panel.transfer.sortCode).toBe("12-34-56");
  });

  it("still refuses a trade who has not completed Connect at all", () => {
    const unonboarded = { ...connectOnly, stripePayoutsEnabled: false };

    expect(buildPayPanel(unonboarded).mode).toBe("setup_incomplete");
  });
});
