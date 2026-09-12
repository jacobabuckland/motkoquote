import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

/**
 * CONN-4: The trade is merchant of record, not motko.
 *
 * src/lib/stripe-payments.ts created PaymentIntents with transfer_data but no
 * on_behalf_of, making motko merchant of record. The customer's bank statement
 * showed "motko" rather than the trade's business. This ticket adds on_behalf_of
 * so the connected account becomes merchant of record.
 *
 * Decision: docs/specs/motko-pre-launch-spec.md D12 (5 Sep 2026).
 */

// Stub the Stripe client to capture params passed to paymentIntents.create.
// This is the same mock used in src/lib/stripe-payments.test.ts — tests for
// this item extend that file's suite rather than duplicating the mock.
const create = vi.fn(
  async (params: Stripe.PaymentIntentCreateParams) =>
    ({ id: "pi_test", client_secret: "cs_test", ...params }) as unknown as Stripe.PaymentIntent,
);

vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => ({ paymentIntents: { create } }),
}));

const { createStripePayment } = await import("@/lib/stripe-payments");

const paramsFromLastCall = (): Stripe.PaymentIntentCreateParams => {
  const call = create.mock.calls[create.mock.calls.length - 1];
  if (!call) throw new Error("paymentIntents.create was never called");
  return call[0];
};

const input = (over: { jobValuePennies?: number; freeJobsRemaining?: number } = {}) => ({
  invoiceId: "inv-1",
  jobId: "job-1",
  contractorId: "contractor-1",
  jobValuePennies: over.jobValuePennies ?? 80_000,
  connectedAccountId: "acct_connected_123",
  freeJobsRemaining: over.freeJobsRemaining ?? 0,
});

describe("Issue #610: The trade is merchant of record, not motko", () => {
  beforeEach(() => {
    create.mockClear();
  });

  // RETIRED 12 Sep 2026 — three assertions, all of them pinning `on_behalf_of`:
  //   "sets on_behalf_of to the connected account"
  //   "sets on_behalf_of to the same account as transfer_data.destination"
  //   "sets on_behalf_of on free jobs where the fee is fully waived"
  //
  // Superseded by Jacob's decision of 12 Sep reversing D12 (recorded in
  // areas/motko.md). Stripe refuses `on_behalf_of` on an account holding
  // `transfers` but not `card_payments`, which createConnectedAccount never
  // requests — so these three asserted a parameter that made every Pay by Bank
  // payment fail. No implementation could satisfy both them and a working
  // payment.
  //
  // The third also asserted `application_fee_amount` is absent on a free job.
  // That claim is unaffected by the reversal and is still covered, by
  // src/lib/stripe-payments.test.ts ("Omitted, not zero — Stripe rejects an
  // explicit 0"). Nothing was lost with it.
  //
  // The absence of `on_behalf_of` is now pinned in that same file, so this is a
  // contract replaced rather than dropped.

  it("does not change the amount, currency, or payment method type", async () => {
    await createStripePayment(input({ jobValuePennies: 150_000 }));
    const params = paramsFromLastCall();

    // The payment structure is unchanged. Only merchant of record switches.
    expect(params.amount).toBe(150_000);
    expect(params.currency).toBe("gbp");
    expect(params.payment_method_types).toEqual(["pay_by_bank"]);
    expect(params.payment_method_data?.type).toBe("pay_by_bank");
  });

});
