import type { SupabaseClient } from "@supabase/supabase-js";

// Subscription management: creation at signup, state reading, and trial ending.
// The `subscription_projection` table is the single source of truth for
// subscription status, projected from Stripe webhooks rather than stored as a
// local boolean (avoiding the Connect-readiness drift class).

const SUBSCRIPTION_PRICE_ID = process.env.STRIPE_SUBSCRIPTION_PRICE_ID ?? "price_placeholder";

/**
 * Creates a Stripe customer and subscription with an open-ended trial for a new contractor.
 * Called once at signup during `provisionNewContractor`.
 *
 * The trial has no `trial_end` date — it continues indefinitely until explicitly
 * ended via `endTrial` when the free-job allowance is exhausted (SUB-2).
 */
export const createSubscription = async (
  admin: SupabaseClient,
  contractorId: string,
): Promise<void> => {
  const { getStripeClient } = await import("@/lib/stripe-client");
  const stripe = getStripeClient();

  // Create Stripe customer
  const customer = await stripe.customers.create({
    metadata: {
      contractor_id: contractorId,
    },
  });

  // Create subscription with open-ended trial (no trial_end)
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: SUBSCRIPTION_PRICE_ID }],
    trial_settings: {
      end_behavior: { missing_payment_method: "pause" },
    },
    // No trial_end means the trial continues indefinitely
  });

  // Write initial projection to local table
  // The webhook handler will look up contractors via this table's stripe_customer_id
  await admin.from("subscription_projection").upsert({
    contractor_id: contractorId,
    stripe_customer_id: customer.id,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    trial_end: subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null,
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    last_event_id: `initial_${subscription.id}`,
  });
};

/**
 * Reads the subscription state for a contractor from the local projection.
 * Returns `null` if no subscription exists yet (not yet provisioned).
 *
 * Never reads a local boolean — the projection is the source of truth, and the
 * projection is ONLY updated by Stripe webhooks (except the initial insert).
 */
export const getSubscriptionState = async (
  supabase: SupabaseClient,
  contractorId: string,
): Promise<{ status: string; inTrial: boolean } | null> => {
  const { data, error } = await supabase
    .from("subscription_projection")
    .select("subscription_status, trial_end")
    .eq("contractor_id", contractorId)
    .single();

  if (error || !data) return null;

  return {
    status: data.subscription_status,
    inTrial: data.subscription_status === "trialing",
  };
};

/**
 * Ends the trial programmatically, allowing the first billing cycle to start.
 * Called by SUB-2 when the free-job allowance is exhausted.
 *
 * Sets `trial_end: "now"` which immediately ends the trial and starts billing.
 * Updates both Stripe and the local projection synchronously.
 */
export const endTrial = async (
  admin: SupabaseClient,
  contractorId: string,
): Promise<void> => {
  // Fetch the subscription ID from the projection
  const { data } = await admin
    .from("subscription_projection")
    .select("*")
    .eq("contractor_id", contractorId)
    .single();

  if (!data) {
    throw new Error(`No subscription found for contractor ${contractorId}`);
  }

  const { getStripeClient } = await import("@/lib/stripe-client");
  const stripe = getStripeClient();

  // End the trial immediately
  const updatedSubscription = await stripe.subscriptions.update(data.stripe_subscription_id, {
    trial_end: "now",
  });

  // Update the local projection immediately (webhook will also update, idempotently)
  await admin.from("subscription_projection").upsert({
    contractor_id: contractorId,
    stripe_customer_id: data.stripe_customer_id,
    stripe_subscription_id: data.stripe_subscription_id,
    subscription_status: updatedSubscription.status,
    trial_end: updatedSubscription.trial_end
      ? new Date(updatedSubscription.trial_end * 1000).toISOString()
      : null,
    current_period_start: updatedSubscription.current_period_start
      ? new Date(updatedSubscription.current_period_start * 1000).toISOString()
      : data.current_period_start,
    current_period_end: updatedSubscription.current_period_end
      ? new Date(updatedSubscription.current_period_end * 1000).toISOString()
      : data.current_period_end,
    last_event_id: data.last_event_id, // Keep existing event ID
  });
};
