import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe-client";
import {
  motkoFeePennies,
  waiverSplit,
  feeWouldSwallowPayment,
} from "@/lib/motko-fee";

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
  /**
   * What Stripe was actually asked to take as the motko fee, in pennies.
   * 0 means no fee was applied — either a free job, or the fee would have met
   * or exceeded the payment itself (see createStripePayment).
   */
  applicationFeePennies: number;
};

// The fee motko takes from this payment, collected at source by Stripe rather
// than accrued and billed later. Returns the payable amount.
//
// The waiver goes through `waiverSplit`, the same function settlement uses, so
// the two paths cannot disagree about what a free job costs. Until SUB-3 this
// branch waived `FEE_STANDARD_PENNIES` (£2) while settlement waived in full, so
// a free job whose fee exceeded £2 was charged the difference at source and
// recorded as free — see the note on `feeWouldSwallowPayment`.
export const applicationFeeForPayment = (
  jobValuePennies: number,
  freeJobsRemaining: number,
): number => {
  const fullFee = motkoFeePennies(jobValuePennies, 0);

  if (freeJobsRemaining > 0) {
    return waiverSplit(fullFee).payablePennies;
  }

  return fullFee;
};

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

  const computedFeePennies = applicationFeeForPayment(
    input.jobValuePennies,
    input.freeJobsRemaining,
  );

  // Never let the fee swallow the payment. Below that line we simply take no
  // fee: the trade is paid in full and the job records `not_applicable` — NOT
  // `accrued`, which would book a debt the trade never agreed to. Settlement
  // reaches the same conclusion from the same predicate. Blocking the payment
  // outright would be worse: a customer cannot pay a small invoice because of
  // our fee.
  const skipped = feeWouldSwallowPayment(computedFeePennies, input.jobValuePennies);
  const applicationFeePennies = skipped ? 0 : computedFeePennies;

  const params: Stripe.PaymentIntentCreateParams = {
    amount: input.jobValuePennies,
    currency: "gbp",
    // `pay_by_bank` is UK open banking: the customer authorises the payment in
    // their own banking app. NOT `customer_balance`, which is Stripe's manual
    // bank-transfer product — that hands the customer Stripe's own sort code to
    // push a transfer to, which is the thing this button exists to replace.
    payment_method_types: ["pay_by_bank"],
    // Attached here rather than client-side so the browser can confirm with just
    // the client secret. `pay_by_bank` is redirect-only and takes no options, so
    // there is nothing for a Payment Element to collect.
    payment_method_data: { type: "pay_by_bank" },
    transfer_data: { destination: input.connectedAccountId },
    // NO `on_behalf_of`, and it may not come back without the capability that
    // makes it legal. See the D12 reversal, 12 Sep, in areas/motko.md.
    //
    // CONN-4 set it on 5 Sep so the customer's statement would read the trade's
    // business rather than motko's (D12, merchant of record). Stripe refuses
    // that combination: `on_behalf_of` on an account holding `transfers` but not
    // `card_payments` is rejected outright, and `createConnectedAccount`
    // deliberately never requests `card_payments`. So every Pay by Bank payment
    // has failed since — on a live £9,056 invoice, the customer was shown
    // Stripe's own API text about capabilities.
    //
    // Restoring it means requesting `card_payments` on connected accounts
    // first, which is more onboarding KYC for every trade and reopens a
    // capability closed on purpose. Jacob, 12 Sep: getting paid today wins.
    metadata: {
      invoice_id: input.invoiceId,
      job_id: input.jobId,
      contractor_id: input.contractorId,
      // The fee ACTUALLY applied to this payment, not the one the bands
      // computed — those differ whenever the fee was skipped above. Settlement
      // reads Stripe's own application_fee_amount, so this is for humans
      // reading the payment in the dashboard.
      motko_fee_pennies: String(applicationFeePennies),
    },
  };

  if (applicationFeePennies > 0) {
    params.application_fee_amount = applicationFeePennies;
  }

  const paymentIntent = await stripe.paymentIntents.create(params);

  return { paymentIntent, applicationFeePennies };
};
