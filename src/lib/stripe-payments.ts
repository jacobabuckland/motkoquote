import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe-client";
import { motkoFeePennies } from "@/lib/motko-fee";

// Pay by Bank has a per-payment ceiling; above it the customer is pushed to a
// different rail rather than being handed a payment that Stripe will refuse.
export const PAY_BY_BANK_LIMIT_PENNIES = 10_000_00;

export type CreateStripePaymentInput = {
  invoiceId: string;
  jobId: string;
  contractorId: string;
  /** Invoice total in pennies. */
  jobValuePennies: number;
  /** The contractor's connected account — the destination of the charge. */
  connectedAccountId: string;
  /** The trade's cached free allowance at the moment of payment. */
  freeJobsRemaining: number;
};

export type CreateStripePaymentResult = {
  paymentIntent: Stripe.PaymentIntent;
  /** What Stripe was asked to take as the motko fee, in pennies. 0 = free job. */
  applicationFeePennies: number;
};

// The fee motko takes from this payment, collected at source by Stripe rather
// than accrued and billed later. Returns 0 for a free job, which the caller
// must translate into *omitting* the parameter — see below.
export const applicationFeeForPayment = (
  jobValuePennies: number,
  freeJobsRemaining: number,
): number => motkoFeePennies(jobValuePennies, freeJobsRemaining);

/**
 * Creates the Pay by Bank payment intent as a destination charge: the money
 * settles to the contractor's connected account, and motko's fee is taken at
 * source as a Stripe application fee.
 *
 * `application_fee_amount` is OMITTED, not set to zero, when the job is free.
 * Stripe requires a positive integer and rejects an explicit 0, so sending it
 * unconditionally fails every free job outright.
 */
export const createStripePayment = async (
  input: CreateStripePaymentInput,
): Promise<CreateStripePaymentResult> => {
  const stripe = getStripeClient();

  const applicationFeePennies = applicationFeeForPayment(
    input.jobValuePennies,
    input.freeJobsRemaining,
  );

  const params: Stripe.PaymentIntentCreateParams = {
    amount: input.jobValuePennies,
    currency: "gbp",
    payment_method_types: ["customer_balance"],
    payment_method_data: { type: "customer_balance" },
    payment_method_options: {
      customer_balance: {
        funding_type: "bank_transfer",
        bank_transfer: { type: "gb_bank_transfer" },
      },
    },
    transfer_data: { destination: input.connectedAccountId },
    metadata: {
      invoice_id: input.invoiceId,
      job_id: input.jobId,
      contractor_id: input.contractorId,
      // Recorded so settlement can tell an at-source fee from a legacy
      // accrued one without re-deriving it from the job's value.
      motko_fee_pennies: String(applicationFeePennies),
    },
  };

  if (applicationFeePennies > 0) {
    params.application_fee_amount = applicationFeePennies;
  }

  const paymentIntent = await stripe.paymentIntents.create(params);

  return { paymentIntent, applicationFeePennies };
};
