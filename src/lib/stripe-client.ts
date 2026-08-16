import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export const getStripeClient = (): Stripe => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey, {
      apiVersion: "2026-07-29.dahlia",
      typescript: true,
    });
  }

  return stripeClient;
};

export type StripeKeyMode = "live" | "test" | "unknown";

// Which mode a Stripe key belongs to, from its prefix. Restricted keys (rk_*)
// and anything unrecognised report "unknown" rather than guessing.
export const stripeKeyMode = (key: string): StripeKeyMode => {
  if (key.startsWith("sk_live_") || key.startsWith("pk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("pk_test_")) return "test";
  return "unknown";
};

/**
 * True when the secret and publishable keys demonstrably belong to different
 * Stripe modes — the configuration that produces the least legible failure we
 * have: the PaymentIntent is created fine against one mode, then Stripe.js
 * cannot find it under the other and the customer is shown a raw
 * "No such payment_intent: pi_…" with a 404 from /confirm.
 *
 * Returns false when either key's mode is unknown (e.g. a restricted key), so
 * an unrecognised-but-valid setup is never blocked on a guess.
 */
export const stripeKeyModesConflict = (
  secretKey: string,
  publishableKey: string,
): boolean => {
  const secret = stripeKeyMode(secretKey);
  const publishable = stripeKeyMode(publishableKey);
  if (secret === "unknown" || publishable === "unknown") return false;
  return secret !== publishable;
};
