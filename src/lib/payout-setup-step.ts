// Where a contractor stands in Stripe Connect onboarding, answering ONE
// question: is there anything left for THEM to do?
//
// That is deliberately not "can they take payments yet". The two come apart,
// and the gap between them is where a setup step traps people. Both Connect
// accounts in production sit in a state where Stripe is asking for nothing,
// the trade has done everything the hosted flow asks, and
// `pay_by_bank_payments` is still inactive — the `awaitingReview` note in
// src/app/settings/stripe-connect-section.tsx documents it at length. Gating
// this step's exit on payability would send exactly that trade back through a
// hosted flow with nothing left in it, every single time they finished setup.
//
// So `submitted` means "hand off to the dashboard, they are done here".
// Whether the money can actually move yet is `canAcceptStripePayment`'s
// question, asked at the invoice, where a wrong answer is visible and
// recoverable.
//
// Read the four booleans' contract in src/lib/stripe-connect.ts before
// changing any of this. `stripe_payouts_enabled` is MISNAMED — it holds
// `capabilities.transfers`, not Stripe's `account.payouts_enabled` — and
// reasoning about these fields from their names has gone wrong here before.

export type PayoutSetupStatus = {
  stripe_account_id: string | null;
  /** `capabilities.transfers` — Stripe has accepted the identity details. */
  stripe_payouts_enabled: boolean;
  /** `capabilities.pay_by_bank_payments` — the account can be paid through. */
  stripe_pay_by_bank_enabled: boolean;
  stripe_requirements_due: boolean;
};

export type PayoutSetupStep =
  /** No connected account: the trade has never started. */
  | "not_started"
  /** An account exists but the trade still has something to supply. */
  | "unfinished"
  /** Nothing left for the trade to do — live, or waiting on Stripe. */
  | "submitted";

export const payoutSetupStep = (status: PayoutSetupStatus): PayoutSetupStep => {
  if (!status.stripe_account_id) return "not_started";

  // Live: Stripe has activated the capability the pay button gates on.
  if (status.stripe_pay_by_bank_enabled) return "submitted";

  // Stripe is asking for something. Either the trade abandoned the hosted flow
  // partway, or a later verification has come due.
  if (status.stripe_requirements_due) return "unfinished";

  // Nothing due, and transfers are active: Stripe has accepted the identity
  // details and is reviewing the rest. Nothing for the trade to do but wait,
  // so asking them to "finish" would be asking for nothing.
  if (status.stripe_payouts_enabled) return "submitted";

  // An account with no capabilities and nothing due yet — created, then
  // abandoned before Stripe had enough to compute requirements from.
  return "unfinished";
};
