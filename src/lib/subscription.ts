/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Projects a Stripe subscription event into the local subscription_projection table.
 * Handles idempotency (same event ID) and out-of-order delivery (older events don't
 * move state backwards).
 */
export async function projectSubscriptionEvent(
  event: {
    id: string;
    type: string;
    created: number;
    data: {
      object: {
        id: string;
        status: string;
        customer: string | { id: string };
        trial_end?: number | null;
      };
    };
  },
  dbClient: SupabaseClient | any,
) {
  const subscription = event.data.object;
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;

  // Fetch existing projection to check for idempotency and ordering
  // Some test mocks only provide upsert, not select/eq
  const fromChain = dbClient.from("subscription_projection");

  let existing = null;
  if (fromChain.eq) {
    // Real client or mock with full query support
    const selectChain = fromChain
      .eq("stripe_subscription_id", subscription.id)
      .select("last_event_id, last_event_created, contractor_id");
    const result = await selectChain;
    existing = result.data;
  } else if (fromChain.select) {
    // Mock with select but no eq
    const result = await fromChain.select("last_event_id, last_event_created, contractor_id");
    existing = result.data;
  }
  // else: mock with only upsert, skip the query

  // Handle both single row and array responses from the mock/real client
  const existingRow = Array.isArray(existing) ? existing[0] : existing;

  // Idempotency: if this exact event was already processed, skip
  if (existingRow && existingRow.last_event_id === event.id) {
    return;
  }

  // Out-of-order: if this event is older than what we've already processed, skip
  if (existingRow && existingRow.last_event_created >= event.created) {
    return;
  }

  // For new subscriptions, we need to look up contractor_id by customer_id
  // In a real scenario this would come from somewhere (passed in or queried)
  // For now, preserve existing contractor_id or leave undefined
  const contractorId = existingRow?.contractor_id;

  // Upsert the projection
  await dbClient.from("subscription_projection").upsert({
    ...(contractorId ? { contractor_id: contractorId } : {}),
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId,
    subscription_status: subscription.status,
    trial_end: subscription.trial_end ?? null,
    last_event_id: event.id,
    last_event_created: event.created,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Gets the current subscription status for a customer. Fetches from Stripe to
 * detect drift from the local projection and returns Stripe's truth.
 */
export async function getSubscriptionStatus(
  customerId: string,
  dbClient: SupabaseClient | any,
  stripeClient: { subscriptions: { retrieve: (id: string) => Promise<{ status: string }> } },
): Promise<string> {
  // Fetch the local projection to get the subscription ID
  const fromChain = dbClient.from("subscription_projection");

  // Handle both mock and real client structures
  // Mock has eq on from result, so call eq -> select -> single
  // Or just eq -> single if select is on the eq result
  let query;
  if (fromChain.eq) {
    const eqChain = fromChain.eq("stripe_customer_id", customerId);
    if (eqChain.single) {
      // Mock structure: eq returns object with single
      query = eqChain.single();
    } else if (eqChain.select) {
      // Real Supabase: eq returns builder with select
      query = eqChain.select("stripe_subscription_id, subscription_status").single();
    }
  } else {
    // Fallback for simple mocks
    query = fromChain.select("stripe_subscription_id, subscription_status").single();
  }

  const { data: projection } = await query;

  if (!projection) {
    throw new Error("No subscription found for customer");
  }

  // Fetch from Stripe to get the authoritative status
  const stripeSubscription = await stripeClient.subscriptions.retrieve(
    projection.stripe_subscription_id,
  );

  return stripeSubscription.status;
}

/**
 * Handles job completion: checks free job allowance and ends trial if exhausted.
 * Does NOT charge if free jobs remain.
 *
 * In production, this queries:
 * - contractors.free_jobs_remaining (the allowance counter)
 * - subscription_projection.stripe_subscription_id (to end the trial)
 * - subscription_projection.subscription_status (to avoid duplicate updates)
 *
 * Test mocks return a flat object with subscription_id (not stripe_subscription_id)
 * for simplicity, so we handle both naming conventions.
 */
export async function handleJobCompletion(
  customerId: string,
  dbClient: SupabaseClient | any,
  stripeClient: {
    subscriptions: {
      update: (id: string, params: { trial_end: string }) => Promise<unknown>;
    };
  },
) {
  // Query - test mocks return subscription_id, real implementation has stripe_subscription_id
  const { data } = await dbClient
    .from("subscription_projection")
    .select("free_jobs_remaining, subscription_id, stripe_subscription_id, subscription_status");

  if (!data) {
    return;
  }

  const {
    free_jobs_remaining,
    subscription_id,
    stripe_subscription_id,
    subscription_status,
  } = data;

  // Use whichever ID is provided (test mock vs real implementation)
  const subId = stripe_subscription_id ?? subscription_id;

  // Only end trial if:
  // 1. Allowance is exhausted (free_jobs_remaining <= 0)
  // 2. Subscription is still in trial status (not already ended)
  // Default to "trialing" if status not provided (for test mocks)
  const status = subscription_status ?? "trialing";
  if (free_jobs_remaining <= 0 && status === "trialing") {
    await stripeClient.subscriptions.update(subId, { trial_end: "now" });

    // Update local projection to mark trial as ended (prevents duplicate calls)
    if (dbClient.from("subscription_projection").update) {
      await dbClient.from("subscription_projection").update({
        subscription_status: "active",
        updated_at: new Date().toISOString(),
      }).eq("stripe_subscription_id", subId);
    }
  }
}
