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
    // D12 reversed 12 Sep: `on_behalf_of` requires `card_payments` on the
    // connected account, which is never requested, so Stripe refused every
    // payment. Asserted ABSENT so it cannot drift back in unnoticed.
    expect("on_behalf_of" in params).toBe(false);
    // customer_balance is a different product and must not leak back in.
    expect(params.payment_method_options).toBeUndefined();
  });

  it("charges the scheduled fee on a job with no free allowance", async () => {
    // £800: 0.99% = 792p, + 39.6p = 831.6p
    const result = await createStripePayment(input({ jobValuePennies: 80_000 }));

    expect(paramsFromLastCall().application_fee_amount).toBe(832);
    expect(result.applicationFeePennies).toBe(832);
  });

  it("charges the cap on a larger job", async () => {
    // £2,000 is well above the £960 where the cap starts biting.
    await createStripePayment(input({ jobValuePennies: 200_000 }));

    expect(paramsFromLastCall().application_fee_amount).toBe(990);
  });

  it("omits application_fee_amount entirely on a free job below the floor", async () => {
    // A job where the computed fee equals the floor (£2) - fully waivable with FEE-2
    const result = await createStripePayment(
      input({ jobValuePennies: 50_000, freeJobsRemaining: 3 }),
    );

    // Omitted, not zero — Stripe rejects an explicit 0.
    const params = paramsFromLastCall();
    expect("application_fee_amount" in params).toBe(false);
    expect(result.applicationFeePennies).toBe(0);
    expect("on_behalf_of" in params).toBe(false);
  });

  it("waives a free job IN FULL, however large — the divergence SUB-3 closed", async () => {
    // £800 costs 832p with no credit. Until SUB-3 this call site waived only
    // FEE_STANDARD_PENNIES (£2) and charged the remainder at source, while
    // settlement waived the lot and recorded the job free. A trade was told the
    // job was free and charged anyway.
    const result = await createStripePayment(
      input({ jobValuePennies: 80_000, freeJobsRemaining: 1 }),
    );

    expect("application_fee_amount" in paramsFromLastCall()).toBe(false);
    expect(result.applicationFeePennies).toBe(0);
  });

  it("waives in full on a job large enough to hit the cap too", async () => {
    const result = await createStripePayment(
      input({ jobValuePennies: 150_000, freeJobsRemaining: 1 }),
    );

    expect("application_fee_amount" in paramsFromLastCall()).toBe(false);
    expect(result.applicationFeePennies).toBe(0);
  });

  it("takes no fee when it would swallow the whole payment", async () => {
    // A 30p invoice costs 40p in fee — the fixed component alone exceeds it.
    // Stripe caps a too-large application fee at the captured amount rather
    // than rejecting it, so sending it would hand motko the entire payment and
    // the trade nothing.
    //
    // The threshold moved with the schedule: under the £2 floor this bit at
    // £2, and now it bites under about 41p. The band is far narrower, but the
    // guard still has to exist — the fixed component means a small enough job
    // always costs more than it is worth.
    const result = await createStripePayment(input({ jobValuePennies: 30 }));
    const params = paramsFromLastCall();

    expect("application_fee_amount" in params).toBe(false);
    expect(result.applicationFeePennies).toBe(0);
    // The customer still pays, and the trade still receives, the full amount.
    expect(params.amount).toBe(30);
    expect("on_behalf_of" in params).toBe(false);
  });

  it("takes no fee when it exactly equals the payment", async () => {
    // 40p job: 0.99% is 0.396p, + 39.6p is 39.996p, which rounds to exactly 40.
    // Equal counts as swallowing — the trade would receive nothing.
    await createStripePayment(input({ jobValuePennies: 40 }));

    expect("application_fee_amount" in paramsFromLastCall()).toBe(false);
  });

  it("charges normally a penny above the line, so the guard is not over-wide", async () => {
    // 100p costs 41p. The guard must not swallow jobs that can afford the fee.
    const result = await createStripePayment(input({ jobValuePennies: 100 }));

    expect(paramsFromLastCall().application_fee_amount).toBe(41);
    expect(result.applicationFeePennies).toBe(41);
  });

  it("records the fee actually applied in metadata, not the one the schedule computed", async () => {
    await createStripePayment(input({ jobValuePennies: 30 }));

    expect(paramsFromLastCall().metadata?.motko_fee_pennies).toBe("0");
  });
});
