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

  it("rails available: leads with the one-tap button and keeps transfer details as a secondary toggle", () => {
    const panel = buildPayPanel({ ...base, railsAvailable: true });
    expect(panel.mode).toBe("button_with_transfer");
    if (panel.mode !== "button_with_transfer") throw new Error("wrong mode");
    // Same trade details are still available as the secondary path.
    expect(panel.transfer.sortCode).toBe("12-34-56");
    expect(panel.transfer.reference).toBe("INVA1B2C3D4E5");
  });

  it("no payable surface at all until the trade completes payout setup", () => {
    // Missing any one field, or the completeness flag, collapses to setup_incomplete
    // regardless of rails — never a broken button, never partial transfer details.
    for (const patch of [
      { payoutDetailsComplete: false },
      { accountHolderName: null },
      { sortCode: null },
      { accountNumber: null },
    ] as Array<Partial<PayPanelInput>>) {
      for (const railsAvailable of [true, false]) {
        expect(buildPayPanel({ ...base, railsAvailable, ...patch }).mode).toBe(
          "setup_incomplete",
        );
      }
    }
  });
});
