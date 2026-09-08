import { describe, expect, it } from "vitest";
import { buildPayPanel, type PayPanelInput } from "./pay-panel";

const base: PayPanelInput = {
  railsAvailable: true,
  payoutDetailsComplete: true,
  accountHolderName: "Acme Ltd",
  sortCode: "123456",
  accountNumber: "12345678",
  companyName: "Acme Ltd",
  firstName: "Dave",
  amount: 8132.14,
  invoiceId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  stripePayoutsEnabled: true,
  stripeRequirementsDue: false,
};

describe("buildPayPanel — customer invoice payment section", () => {
  it("rails unavailable: transfer block is the primary path, with the trade's details and a guidance name — and NO one-tap button", () => {
    const panel = buildPayPanel({ ...base, railsAvailable: false });
    expect(panel.mode).toBe("transfer_only");
    if (panel.mode !== "transfer_only") throw new Error("wrong mode");
    // The customer can always pay: full transfer details are present.
    expect(panel.transfer).toEqual({
      accountHolderName: "Acme Ltd",
      sortCode: "12-34-56",
      accountNumber: "12345678",
      amount: "£8,132.14",
      reference: "INVA1B2C3D4E5",
    });
    // Guidance names the person who marks it paid.
    expect(panel.guidanceName).toBe("Dave");
  });

  it("falls back to the company name in guidance when the trade has no first name", () => {
    const panel = buildPayPanel({ ...base, railsAvailable: false, firstName: null });
    if (panel.mode !== "transfer_only") throw new Error("wrong mode");
    expect(panel.guidanceName).toBe("Acme Ltd");
  });

  it("rails available: the button is the only path, and NO transfer details are produced", () => {
    // Changed deliberately. This used to return button_with_transfer carrying
    // the trade's sort code and account number, which the page rendered inside
    // a <details> toggle — shipped in the response body whether or not the
    // customer expanded it. Under PAY-4 fee-at-source that is a documented
    // route around the fee: the customer transfers direct, the contractor is
    // paid in full, and motko earns nothing.
    const panel = buildPayPanel({ ...base, railsAvailable: true });
    expect(panel.mode).toBe("button_only");
    // Asserted on the object, not on what the page chooses to render: the
    // details must be ABSENT, not merely unrendered.
    expect("transfer" in panel).toBe(false);
  });

  it("no payable surface at all until Connect onboarding completes", () => {
    // CONN-6: Connect completion is now required for payability. Missing
    // stripePayoutsEnabled or having stripeRequirementsDue blocks all payment modes.
    for (const patch of [
      { stripePayoutsEnabled: false },
      { stripeRequirementsDue: true },
    ] as Array<Partial<PayPanelInput>>) {
      for (const railsAvailable of [true, false]) {
        expect(buildPayPanel({ ...base, railsAvailable, ...patch }).mode).toBe(
          "setup_incomplete",
        );
      }
    }
  });

  it("Connect-complete contractor can use pay button even without manual bank details", () => {
    // CONN-6: Manual bank details are no longer required for button_only mode.
    // A Connect-complete contractor with rails available is payable.
    const panel = buildPayPanel({
      ...base,
      railsAvailable: true,
      payoutDetailsComplete: false,
      accountHolderName: null,
      sortCode: null,
      accountNumber: null,
    });
    expect(panel.mode).toBe("button_only");
  });

  it("Connect-complete contractor returns button_only even when rails unavailable", () => {
    // CONN-6: When Connect is complete but manual bank details are missing,
    // return button_only (not setup_incomplete) even when rails are unavailable.
    // The contractor IS payable (via Stripe), just can't handle transfer_only
    // edge cases. The button will handle amount-too-high or rails-unavailable
    // errors rather than incorrectly showing "setup incomplete".
    for (const patch of [
      { accountHolderName: null },
      { sortCode: null },
      { accountNumber: null },
    ] as Array<Partial<PayPanelInput>>) {
      expect(buildPayPanel({ ...base, railsAvailable: false, ...patch }).mode).toBe(
        "button_only",
      );
    }
  });
});
