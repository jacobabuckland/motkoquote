import { describe, expect, it } from "vitest";
import { payoutSetupStep, type PayoutSetupStatus } from "./payout-setup-step";

const status = (overrides: Partial<PayoutSetupStatus> = {}): PayoutSetupStatus => ({
  stripe_account_id: null,
  stripe_payouts_enabled: false,
  stripe_pay_by_bank_enabled: false,
  stripe_requirements_due: false,
  ...overrides,
});

describe("payoutSetupStep", () => {
  it("is not_started when no connected account exists", () => {
    expect(payoutSetupStep(status())).toBe("not_started");
  });

  it("is unfinished when Stripe is still asking the trade for something", () => {
    expect(
      payoutSetupStep(
        status({ stripe_account_id: "acct_1", stripe_requirements_due: true }),
      ),
    ).toBe("unfinished");
  });

  it("is unfinished when an account was created and abandoned", () => {
    expect(payoutSetupStep(status({ stripe_account_id: "acct_1" }))).toBe(
      "unfinished",
    );
  });

  it("is submitted once the account can be paid through", () => {
    expect(
      payoutSetupStep(
        status({
          stripe_account_id: "acct_1",
          stripe_pay_by_bank_enabled: true,
          stripe_payouts_enabled: true,
        }),
      ),
    ).toBe("submitted");
  });

  // THE STATE THAT WOULD LOOP. Both production accounts sit exactly here:
  // transfers active, nothing currently due, pay_by_bank not yet active. The
  // trade has been all the way through Stripe's flow and is waiting on Stripe.
  // Treating this as unfinished would hand them a "finish setting up" button
  // that reopens a flow with nothing in it, every time they complete setup.
  it("is submitted while Stripe reviews, with nothing due and transfers active", () => {
    expect(
      payoutSetupStep(
        status({
          stripe_account_id: "acct_1",
          stripe_payouts_enabled: true,
          stripe_pay_by_bank_enabled: false,
          stripe_requirements_due: false,
        }),
      ),
    ).toBe("submitted");
  });

  // The same shape with requirements outstanding is a genuinely half-finished
  // onboarding, and must stay distinguishable from the one above.
  it("is unfinished when transfers are active but Stripe still wants more", () => {
    expect(
      payoutSetupStep(
        status({
          stripe_account_id: "acct_1",
          stripe_payouts_enabled: true,
          stripe_requirements_due: true,
        }),
      ),
    ).toBe("unfinished");
  });
});
