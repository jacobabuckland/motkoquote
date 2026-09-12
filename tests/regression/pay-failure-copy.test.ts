// No payment provider's text reaches a customer.
//
// Reported 12 Sep, from a live £9,056 invoice. The pay panel rendered Stripe's
// own API error verbatim:
//
//   "You cannot create a charge with the `on_behalf_of` parameter set to a
//    connected account with `transfers` but without the `card_payments`
//    capability enabled."
//
// The server route already returned a safe line when the PaymentIntent could not
// be CREATED. This came through the browser instead — `confirmError.message`
// from stripe.confirmPayment, passed straight to the screen.
import { describe, expect, it } from "vitest";
import { describePayFailure, type ProviderError } from "@/lib/pay-failure";

// Verbatim, because it is the one that shipped.
const THE_REPORTED_ERROR: ProviderError = {
  message:
    "You cannot create a charge with the `on_behalf_of` parameter set to a " +
    "connected account with `transfers` but without the `card_payments` " +
    "capability enabled.",
  type: "invalid_request_error",
};

// Anything that would give away how the platform is wired, or read as jargon.
const LEAKS = [
  "on_behalf_of",
  "card_payments",
  "transfers",
  "capability",
  "connected account",
  "`",
  "PaymentIntent",
  "stripe",
  "acct_",
];

describe("the reported error", () => {
  it("is not shown to the customer", () => {
    const { message } = describePayFailure(THE_REPORTED_ERROR);
    for (const leak of LEAKS) {
      expect(message.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it("tells the customer it is not their end, and not to keep pressing", () => {
    // Retrying cannot succeed — the sender's account lacks a capability. The
    // panel drops "you can try again" on a terminal failure, so this is what
    // routes them to bank transfer instead of a dead button.
    const failure = describePayFailure(THE_REPORTED_ERROR);
    expect(failure.retryable).toBe(false);
    expect(failure.message).toMatch(/sender's side, not yours/);
  });
});

describe("nothing from the provider escapes, on any branch", () => {
  const cases: { name: string; error: ProviderError | null | undefined }[] = [
    { name: "an unrecognised error", error: { message: "acct_1234 rejected the charge" } },
    { name: "a coded error", error: { code: "payment_intent_authentication_failure" } },
    { name: "a card error", error: { type: "card_error", message: "Your card was declined." } },
    { name: "an empty object", error: {} },
    { name: "null", error: null },
    { name: "undefined", error: undefined },
  ];

  for (const { name, error } of cases) {
    it(`returns copy we own for ${name}`, () => {
      const { message } = describePayFailure(error);
      expect(message.length).toBeGreaterThan(0);
      // The giveaway: an unrecognised provider message must not survive.
      expect(message).not.toContain("acct_1234");
      expect(message).not.toContain("`");
    });
  }

  it("does not echo an unrecognised message even when one is present", () => {
    const { message, retryable } = describePayFailure({
      message: "Some new Stripe wording nobody has seen before",
    });
    expect(message).toBe("The payment couldn't be completed.");
    expect(retryable).toBe(true);
  });
});

describe("the failures a customer can act on are still distinguished", () => {
  it("names an authorisation failure as their bank's", () => {
    const failure = describePayFailure({
      code: "payment_intent_authentication_failure",
    });
    expect(failure.message).toMatch(/wasn't authorised by your bank/);
    expect(failure.retryable).toBe(true);
  });

  it("marks an over-limit amount terminal, because retrying cannot help", () => {
    const failure = describePayFailure({ code: "amount_too_large" });
    expect(failure.retryable).toBe(false);
  });

  it("treats an account-level refusal as the sender's setup", () => {
    for (const code of [
      "account_invalid",
      "account_capabilities_mismatch",
      "charges_not_allowed",
      "transfers_not_allowed",
    ]) {
      const failure = describePayFailure({ code });
      expect(failure.retryable, code).toBe(false);
      expect(failure.message, code).toMatch(/sender's side/);
    }
  });
});
