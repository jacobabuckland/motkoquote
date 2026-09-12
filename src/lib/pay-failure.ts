// What a customer is told when a payment will not go through.
//
// Reported 12 Sep, from a live invoice for £9,056. The panel rendered Stripe's
// own API text, verbatim, backticks and parameter names included:
//
//   "You cannot create a charge with the `on_behalf_of` parameter set to a
//    connected account with `transfers` but without the `card_payments`
//    capability enabled."
//
// A customer can do nothing with that sentence. It names two Stripe
// capabilities and an API parameter, it reads as the sender's software being
// broken, and it discloses how the platform is wired to anyone who opens an
// invoice link. The server route already returns a safe message when the
// PaymentIntent cannot be CREATED — this arrived by the other door, from
// `stripe.confirmPayment` in the browser, where `confirmError.message` was
// passed straight to the screen.
//
// The rule: no text from a payment provider reaches a customer unless this
// module put it there. Unrecognised failures get the generic line and the real
// message goes to the console for whoever is debugging.
//
// The on_behalf_of failure itself was fixed separately (D12 reversed, 12 Sep —
// see src/lib/stripe-payments.ts). This module is what stops the NEXT provider
// error being the customer's problem to read.

export type PayFailure = {
  /** Customer-facing. Never contains provider text. */
  message: string;
  /**
   * Whether pressing the button again could plausibly work. Terminal failures
   * drop the "you can try again" half, because telling a customer to retry
   * something that cannot succeed is worse than saying nothing.
   */
  retryable: boolean;
};

/** The shape of a Stripe.js confirm error, narrowed to what is worth reading. */
export type ProviderError = {
  message?: string | null;
  code?: string | null;
  decline_code?: string | null;
  type?: string | null;
};

const GENERIC: PayFailure = {
  message: "The payment couldn't be completed.",
  retryable: true,
};

// A failure in how the SENDER's account is set up. The customer cannot fix it
// and retrying cannot succeed, so it says so plainly and sends them to the
// other rail rather than leaving them pressing a dead button.
//
// `on_behalf_of`/capability errors land here, and so does any account-level
// refusal Stripe reports the same way. Deliberately one message for the whole
// class: the distinctions inside it are ours to act on, not the customer's.
const SENDER_SETUP: PayFailure = {
  message:
    "This payment can't be taken online at the moment — it's something on the " +
    "sender's side, not yours.",
  retryable: false,
};

const isSenderSetupFailure = (error: ProviderError): boolean => {
  const code = error.code ?? "";
  if (
    code === "account_invalid" ||
    code === "account_capabilities_mismatch" ||
    code === "charges_not_allowed" ||
    code === "transfers_not_allowed"
  ) {
    return true;
  }

  // Stripe reports the on_behalf_of capability refusal as an invalid_request
  // with no stable code, so the message is the only handle. Matched on the
  // parameter and capability names, which are Stripe's vocabulary and do not
  // move; the text around them does. Nothing matched here is ever shown.
  const message = (error.message ?? "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("on_behalf_of") ||
    message.includes("capability") ||
    message.includes("connected account")
  );
};

/**
 * The customer-facing account of a failed payment.
 *
 * Always returns copy this module owns. The provider's own message is never
 * returned, under any branch, including the fallback.
 */
export const describePayFailure = (error: ProviderError | null | undefined): PayFailure => {
  if (!error) return GENERIC;

  if (isSenderSetupFailure(error)) return SENDER_SETUP;

  const code = error.code ?? "";

  if (code === "payment_intent_authentication_failure") {
    return {
      message: "The payment wasn't authorised by your bank.",
      retryable: true,
    };
  }

  if (code === "amount_too_large") {
    return {
      message: "This amount is above the online payment limit.",
      retryable: false,
    };
  }

  if (code === "payment_intent_payment_attempt_failed" || error.type === "card_error") {
    return { message: "Your bank didn't complete the payment.", retryable: true };
  }

  return GENERIC;
};
