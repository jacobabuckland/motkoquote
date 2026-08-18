import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// Captures the params handed to Stripe so each test can assert the shape of the
// PaymentIntent we asked for, rather than merely that we asked for one.
const create = vi.fn(
  async (params: Stripe.PaymentIntentCreateParams) =>
    ({ id: "pi_test", client_secret: "cs_test", ...params }) as unknown as Stripe.PaymentIntent,
);

vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => ({ paymentIntents: { create } }),
}));

const { createStripePayment } = await import("@/lib/stripe-payments");

const paramsFromLastCall = (): Stripe.PaymentIntentCreateParams => {
  const call = create.mock.calls[0];
  if (!call) throw new Error("paymentIntents.create was never called");
  return call[0];
};

const input = (over: { jobValuePennies?: number; freeJobsRemaining?: number } = {}) => ({
  invoiceId: "inv-1",
  jobId: "job-1",
  contractorId: "contractor-1",
  jobValuePennies: over.jobValuePennies ?? 80_000,
  connectedAccountId: "acct_123",
  freeJobsRemaining: over.freeJobsRemaining ?? 0,
});

describe("createStripePayment", () => {
  beforeEach(() => {
    create.mockClear();
  });

  it("creates a pay_by_bank destination charge, not a bank transfer", async () => {
    await createStripePayment(input());
    const params = paramsFromLastCall();

    expect(params.payment_method_types).toEqual(["pay_by_bank"]);
    expect(params.payment_method_data?.type).toBe("pay_by_bank");
    expect(params.currency).toBe("gbp");
    expect(params.transfer_data?.destination).toBe("acct_123");
    // customer_balance is a different product and must not leak back in.
    expect(params.payment_method_options).toBeUndefined();
  });

  it("charges the standard fee band on a job with no free allowance", async () => {
    const result = await createStripePayment(input({ jobValuePennies: 80_000 }));

    expect(paramsFromLastCall().application_fee_amount).toBe(200);
    expect(result.applicationFeePennies).toBe(200);
  });

  it("charges the large fee band above the threshold", async () => {
    await createStripePayment(input({ jobValuePennies: 200_000 }));

    expect(paramsFromLastCall().application_fee_amount).toBe(400);
  });

  it("omits application_fee_amount entirely on a free job", async () => {
    const result = await createStripePayment(
      input({ jobValuePennies: 80_000, freeJobsRemaining: 3 }),
    );

    // Omitted, not zero — Stripe rejects an explicit 0.
    expect("application_fee_amount" in paramsFromLastCall()).toBe(false);
    expect(result.applicationFeePennies).toBe(0);
  });

  it("takes no fee when it would swallow the whole payment", async () => {
    // £1 invoice, no free allowance: the band says £2. Stripe caps a too-large
    // application fee at the captured amount rather than rejecting it, so
    // sending it would hand motko the entire payment and the trade nothing.
    const result = await createStripePayment(input({ jobValuePennies: 100 }));
    const params = paramsFromLastCall();

    expect("application_fee_amount" in params).toBe(false);
    expect(result.applicationFeePennies).toBe(0);
    // The customer still pays, and the trade still receives, the full amount.
    expect(params.amount).toBe(100);
  });

  it("takes no fee when it exactly equals the payment", async () => {
    // A £2 invoice against a £2 fee would leave the trade with nothing.
    await createStripePayment(input({ jobValuePennies: 200 }));

    expect("application_fee_amount" in paramsFromLastCall()).toBe(false);
  });

  it("records the fee actually applied in metadata, not the one the bands computed", async () => {
    await createStripePayment(input({ jobValuePennies: 100 }));

    expect(paramsFromLastCall().metadata?.motko_fee_pennies).toBe("0");
  });
});
