// Stripe client initialization and configuration.
//
// motko uses Stripe Connect Express accounts to route destination charges to
// contractors. Each contractor onboards via Stripe-hosted Account Links (not
// custom KYC UI), and we persist only the connected account ID + capability
// status flags in our database. The platform account has Connect capabilities
// active.

import Stripe from "stripe";

// Initialize Stripe client with the secret key from environment.
// Stripe SDK auto-detects test vs live mode from the key prefix (sk_test_ vs sk_live_).
const getStripeClient = (): Stripe | null => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return null;
  }

  // Environment safety check: prevent live keys in non-production environments
  const isProduction = process.env.NODE_ENV === "production";
  const isLiveKey = secretKey.startsWith("sk_live_");

  if (!isProduction && isLiveKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is a live key (sk_live_) in non-production environment. Use test keys (sk_test_) outside production.",
    );
  }

  return new Stripe(secretKey, {
    apiVersion: "2026-07-29.dahlia",
    typescript: true,
  });
};

export const stripe = getStripeClient();

// Export test mode flag for acceptance tests
export const testMode =
  process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ?? true;
