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

  it("charges the ladder-derived fee on a job with no free allowance", async () => {
    // £800 * 0.3% = £2.40 service fee
    // £800 processing: (80000 * 50 / 10000) + 20 = 400 + 20 = 420p
    // Combined: 240 + 420 = 660p
    const result = await createStripePayment(input({ jobValuePennies: 80_000 }));

    expect(paramsFromLastCall().application_fee_amount).toBe(660);
    expect(result.applicationFeePennies).toBe(660);
  });

  it("charges the ladder-derived fee for larger jobs", async () => {
    // £2,000 * 0.3% = £6.00 service fee
    // £2,000 processing: (200000 * 50 / 10000) + 20 = 1000 + 20 = 1020p, capped at 500p
    // Combined: 600 + 500 = 1100p
    await createStripePayment(input({ jobValuePennies: 200_000 }));

    expect(paramsFromLastCall().application_fee_amount).toBe(1100);
  });

  it("charges only processing fee on a free job below the floor (FEE-7)", async () => {
    // A job where the service fee equals the floor (£2) and is fully waivable with FEE-2
    // £500 service fee: £2.00 (floor), waived completely → 0p
    // £500 processing: (50000 * 50 / 10000) + 20 = 250 + 20 = 270p
    // Combined: 0 + 270 = 270p
    const result = await createStripePayment(
      input({ jobValuePennies: 50_000, freeJobsRemaining: 3 }),
    );

    // FEE-7: Still charges the processing fee even though service is waived
    expect(paramsFromLastCall().application_fee_amount).toBe(270);
    expect(result.applicationFeePennies).toBe(270);
  });

  it("charges partial fee on a job above the floor with free credit (FEE-2 + FEE-7)", async () => {
    // £800 * 0.3% = £2.40 (240p), waive £2 (200p), service charge 40p
    // £800 processing: (80000 * 50 / 10000) + 20 = 400 + 20 = 420p
    // Combined: 40 + 420 = 460p
    const result = await createStripePayment(
      input({ jobValuePennies: 80_000, freeJobsRemaining: 1 }),
    );

    expect(paramsFromLastCall().application_fee_amount).toBe(460);
    expect(result.applicationFeePennies).toBe(460);
  });

  it("charges the payable remainder on a job with free credit (FEE-2 + FEE-7)", async () => {
    // £1,500 job with one free credit: full service fee is £1,500 * 0.3% = £4.50 (450p), waived £2 (200p), payable service £2.50 (250p)
    // £1,500 processing: (150000 * 50 / 10000) + 20 = 750 + 20 = 770p, capped at 500p
    // Combined: 250 + 500 = 750p
    const result = await createStripePayment(
      input({ jobValuePennies: 150_000, freeJobsRemaining: 1 }),
    );

    // Stripe collects the payable service remainder + processing fee
    expect(paramsFromLastCall().application_fee_amount).toBe(750);
    expect(result.applicationFeePennies).toBe(750);
  });

  it("takes no fee when it would swallow the whole payment (FEE-7 guard)", async () => {
    // £1 invoice, no free allowance: service floor says £2, processing ~£0.21.
    // Combined fee would exceed payment. Stripe caps a too-large application fee
    // at the captured amount rather than rejecting it, so sending it would hand
    // motko the entire payment and the trade nothing.
    const result = await createStripePayment(input({ jobValuePennies: 100 }));
    const params = paramsFromLastCall();

    // FEE-7: Both components skipped, application_fee_amount omitted (undefined)
    expect("application_fee_amount" in params).toBe(false);
    expect(result.applicationFeePennies).toBe(0);
    // The customer still pays, and the trade still receives, the full amount.
    expect(params.amount).toBe(100);
  });

  it("takes no fee when combined fee would equal or exceed the payment (FEE-7)", async () => {
    // A £2 invoice: service £2 + processing £0.30 = £2.30, exceeds payment.
    await createStripePayment(input({ jobValuePennies: 200 }));

    // FEE-7: Both components skipped, application_fee_amount omitted
    expect("application_fee_amount" in paramsFromLastCall()).toBe(false);
  });

  it("records the fee actually applied in metadata, not the one computed (FEE-7)", async () => {
    // £1 invoice: combined fee would be £2.21, but guard skips both → 0
    await createStripePayment(input({ jobValuePennies: 100 }));

    expect(paramsFromLastCall().metadata?.motko_fee_pennies).toBe("0");
  });
});
