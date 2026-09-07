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

  it("sets on_behalf_of to the connected account", async () => {
    await createStripePayment(input());
    const params = paramsFromLastCall();

    // The connected account is merchant of record.
    expect(params.on_behalf_of).toBe("acct_connected_123");
  });

  it("sets on_behalf_of to the same account as transfer_data.destination", async () => {
    await createStripePayment(input());
    const params = paramsFromLastCall();

    // Both fields reference the same connected account — that is what makes the
    // trade merchant of record on a destination charge.
    expect(params.on_behalf_of).toBe(params.transfer_data?.destination);
    expect(params.on_behalf_of).toBe("acct_connected_123");
    expect(params.transfer_data?.destination).toBe("acct_connected_123");
  });

  it("sets on_behalf_of on free jobs where the fee is fully waived", async () => {
    await createStripePayment(input({ jobValuePennies: 50_000, freeJobsRemaining: 3 }));
    const params = paramsFromLastCall();

    // Merchant of record switches even when no fee is collected. The customer's
    // bank statement still shows the trade, not motko.
    expect(params.on_behalf_of).toBe("acct_connected_123");
    expect("application_fee_amount" in params).toBe(false);
  });





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
