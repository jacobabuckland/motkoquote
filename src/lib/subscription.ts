// SUB-1 — the £9.99/month subscription, and the projection of its state.
//
// Two rules from the pre-launch spec shape everything here:
//
//   D18  Billing starts when the three free jobs are used, NOT on a timer.
//        There is no time-based trial. So the subscription is created at signup
//        with an open-ended trial and the trial is ended PROGRAMMATICALLY when
//        the allowance is exhausted.
//   D4   The allowance is decremented by any COMPLETED job however it settled —
//        rail, cash, cheque or bank transfer. A trade who never connects Stripe
//        must still exhaust it, or they are free forever.
//
// STATE IS DERIVED FROM STRIPE, never held as a local boolean. `subscription_projection`
// is a projection of provider state: every field is written from a webhook event
// and nothing else decides it. That is what makes replay and out-of-order
// delivery survivable, which is this item's headline acceptance criterion.
//
// The decision logic below is pure and I/O-free so it can be tested against the
// exact sequences Stripe actually delivers — a redelivery, a reordering, a
// same-second pair — without a database or a network.

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

/** A row of `subscription_projection` as migration 69 defines it. */
export type SubscriptionProjection = {
  contractor_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  subscription_status: string;
  /** Unix seconds, as Stripe sends it. `bigint` in the database, not a timestamp. */
  trial_end: number | null;
  last_event_id: string;
  /** `event.created`, unix seconds. The ordering key. */
  last_event_created: number;
};

/**
 * The parts of a `customer.subscription.*` event this projection reads. Narrowed
 * from Stripe's type at the edge so the logic below never depends on the SDK's
 * shape — which has moved before: `current_period_start` and `current_period_end`
 * are not on the Subscription in current API versions, and this table has no
 * column for them by design.
 */
export type SubscriptionEvent = {
  id: string;
  created: number;
  subscriptionId: string;
  customerId: string;
  status: string;
  trialEnd: number | null;
  /**
   * From `subscription.metadata.contractor_id`, set when the subscription is
   * created. Metadata lives on the OBJECT, not the event envelope, so Stripe
   * carries it on every delivery including redeliveries — which is why this is
   * the link rather than a `contractors.stripe_customer_id` column that would
   * need a migration. Null only for a subscription created outside this code.
   */
  contractorId: string | null;
};

export type ProjectionDecision =
  | { apply: true; row: SubscriptionProjection }
  | { apply: false; reason: "replay" | "out-of-order" };

/**
 * Whether an incoming event should be written, and what the row becomes.
 *
 * REPLAY. Stripe redelivers on any non-2xx, and will redeliver an event it has
 * already delivered successfully. An event whose id we have already stored is
 * dropped: re-applying it is harmless for status but would advance nothing and
 * masks a genuine duplicate in the logs.
 *
 * OUT OF ORDER. Delivery order is not guaranteed. An event created BEFORE the
 * one we have already applied is stale and must not overwrite it — that is how
 * a cancelled subscription silently returns to `active`. Compared on
 * `event.created` rather than arrival time, because arrival time is the thing
 * that is unreliable.
 *
 * SAME SECOND. Stripe stamps `created` in whole seconds and can emit several
 * events within one. Strictly-older is what loses, so a same-second event is
 * applied in arrival order. That is a deliberate choice: the alternative drops
 * legitimate transitions, and Stripe's own guidance is that same-second events
 * are not orderable from the timestamp alone.
 */
export const projectSubscriptionEvent = (
  current: SubscriptionProjection | null,
  event: SubscriptionEvent,
  contractorId: string,
): ProjectionDecision => {
  if (current) {
    if (current.last_event_id === event.id) {
      return { apply: false, reason: "replay" };
    }
    if (event.created < current.last_event_created) {
      return { apply: false, reason: "out-of-order" };
    }
  }

  return {
    apply: true,
    row: {
      contractor_id: contractorId,
      stripe_subscription_id: event.subscriptionId,
      stripe_customer_id: event.customerId,
      subscription_status: event.status,
      trial_end: event.trialEnd,
      last_event_id: event.id,
      last_event_created: event.created,
    },
  };
};

/**
 * Whether the subscription is in a read-only state due to failed payment.
 *
 * Returns true when the status is `past_due` or `unpaid` — the states Stripe
 * moves to when a subscription payment fails. In these states the trade can
 * view existing work but cannot create new jobs, quotes, contracts, or invoices.
 *
 * Treats null and absent statuses as permissive (returns false) — a contractor
 * without a subscription row or with a null status is not locked out. Only the
 * explicit failed-payment states restrict access.
 */
export const isSubscriptionReadOnly = (status: string | null): boolean =>
  status === "past_due" || status === "unpaid";

/**
 * Whether the open-ended trial should now be ended.
 *
 * Both conditions are load-bearing:
 *
 *   allowance exhausted — "a trade with unused free jobs is never charged" is an
 *   acceptance criterion, so this is `<= 0`, not `< 1` on a possibly-negative
 *   cache. A negative balance is still exhausted.
 *
 *   still trialing — makes the call idempotent. Job four, five and six all
 *   arrive after the allowance hit zero; only the first should reach Stripe. An
 *   already-active subscription is left alone, and so is a cancelled one, which
 *   must never be quietly revived by another completed job.
 */
export const shouldEndTrial = (input: {
  freeJobsRemaining: number;
  subscriptionStatus: string | null;
}): boolean => input.freeJobsRemaining <= 0 && input.subscriptionStatus === "trialing";

/** Narrows a Stripe subscription object to the fields the projection stores. */
export const toSubscriptionEvent = (
  event: Pick<Stripe.Event, "id" | "created">,
  subscription: Stripe.Subscription,
): SubscriptionEvent => ({
  id: event.id,
  created: event.created,
  subscriptionId: subscription.id,
  customerId:
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id,
  status: subscription.status,
  trialEnd: subscription.trial_end ?? null,
  contractorId: subscription.metadata?.contractor_id ?? null,
});

/**
 * Applies one `customer.subscription.*` event to the projection.
 *
 * Returns what it decided so the caller can log it. A dropped event is a
 * success, not a failure — returning non-2xx to Stripe would make it redeliver
 * an event we have deliberately ignored, forever.
 *
 * The contractor comes from the subscription's own metadata. Where that is
 * absent — a subscription created before this code, or by hand in the Stripe
 * dashboard — it falls back to the projection row already keyed to that
 * subscription id, so an existing trade keeps projecting rather than silently
 * dropping every event.
 */
export const applySubscriptionEvent = async (
  admin: SupabaseClient,
  event: SubscriptionEvent,
): Promise<ProjectionDecision | { apply: false; reason: "unknown-contractor" }> => {
  const { data: existing } = await admin
    .from("subscription_projection")
    .select(
      "contractor_id, stripe_subscription_id, stripe_customer_id, subscription_status, trial_end, last_event_id, last_event_created",
    )
    .eq("stripe_subscription_id", event.subscriptionId)
    .maybeSingle();

  const current = (existing as SubscriptionProjection | null) ?? null;
  const contractorId = event.contractorId ?? current?.contractor_id ?? null;

  if (!contractorId) {
    return { apply: false, reason: "unknown-contractor" };
  }

  const decision = projectSubscriptionEvent(current, event, contractorId);

  if (!decision.apply) return decision;

  // Upsert on the primary key: one row per contractor, rebuilt from provider
  // state. Writes go through the service role, which bypasses the RLS added by
  // migration 74 — a user session may read its own row and never write one.
  await admin
    .from("subscription_projection")
    .upsert(decision.row, { onConflict: "contractor_id" });

  return decision;
};

/** £9.99/month, in pennies. D3. */
export const SUBSCRIPTION_PRICE_PENNIES = 999;

/**
 * Creates the subscription at signup, with an OPEN-ENDED trial.
 *
 * D18: there is no time-based trial. `trial_end: OPEN_ENDED_TRIAL_END_UNIX` parks the
 * subscription in `trialing` indefinitely; `endTrialIfAllowanceExhausted` is the
 * only thing that ends it, when the three free jobs are gone. A trade who never
 * connects Stripe still exhausts the allowance on cash and cheque work (D4), so
 * nobody is free forever.
 *
 * Idempotent: a trade who re-runs setup already has a projection row, and this
 * returns it rather than creating a second subscription. That matters because
 * setup is re-enterable by design.
 *
 * `metadata.contractor_id` is the link every later webhook resolves through —
 * it lives on the object, so Stripe carries it on redeliveries too.
 *
 * Nothing here writes `subscription_projection`. The `customer.subscription.created`
 * webhook does that, from Stripe's own state, which is what keeps the projection
 * honest. This function creates and returns; it does not project.
 */
export const createSubscriptionForContractor = async (
  admin: SupabaseClient,
  stripe: Pick<Stripe, "customers" | "subscriptions">,
  input: { contractorId: string; email: string; companyName: string; priceId: string },
): Promise<{ created: boolean; subscriptionId?: string; reason?: string }> => {
  const { data: existing } = await admin
    .from("subscription_projection")
    .select("stripe_subscription_id")
    .eq("contractor_id", input.contractorId)
    .maybeSingle();

  if (existing) {
    return {
      created: false,
      subscriptionId: (existing as { stripe_subscription_id: string }).stripe_subscription_id,
      reason: "already-subscribed",
    };
  }

  // IDEMPOTENCY KEYS ARE LOAD-BEARING, not belt-and-braces.
  //
  // This runs from `persistContractorSetup`, which the manual form calls on
  // every AUTOSAVE. The projection-row check above only helps once the
  // `customer.subscription.created` webhook has landed; in the seconds before
  // it does, a second autosave would otherwise create a second customer and a
  // second subscription, and start billing a trade twice.
  //
  // Keyed on the contractor, so every retry inside Stripe's 24-hour window
  // returns the original object rather than making a new one. That window
  // comfortably covers a setup session, and the projection row covers the rest
  // of time.
  const customer = await stripe.customers.create(
    {
      email: input.email,
      name: input.companyName,
      metadata: { contractor_id: input.contractorId },
    },
    { idempotencyKey: `subscription-customer:${input.contractorId}` },
  );

  const subscription = await stripe.subscriptions.create(
    {
      customer: customer.id,
      items: [{ price: input.priceId }],
      // Far-future rather than a duration: the trial ends on allowance, and
      // nothing should end it on a clock. Stripe requires a concrete timestamp,
      // so "open-ended" is expressed as one far enough out to be unreachable.
      trial_end: OPEN_ENDED_TRIAL_END_UNIX,
      metadata: { contractor_id: input.contractorId },
    },
    { idempotencyKey: `subscription-create:${input.contractorId}` },
  );

  return { created: true, subscriptionId: subscription.id };
};

/**
 * 1 January 2100. Stripe has no "no end" trial, so an open-ended trial is a
 * timestamp beyond any plausible account life. It is never reached in practice:
 * `endTrialIfAllowanceExhausted` moves it to `now` on the third completed job.
 */
export const OPEN_ENDED_TRIAL_END_UNIX = 4_102_444_800;

/**
 * Ends the trial when the free-job allowance is spent. Called from the
 * settlement path after the allowance has been decremented.
 *
 * Best effort by design: a trade has completed a job and that must not fail
 * because Stripe is briefly unreachable. The allowance is already at zero and
 * the projection still says `trialing`, so the next completed job retries this
 * — and if none comes, `shouldEndTrial` stays true until one does.
 */
export const endTrialIfAllowanceExhausted = async (
  admin: SupabaseClient,
  stripe: Pick<Stripe, "subscriptions">,
  contractorId: string,
): Promise<{ ended: boolean; reason?: string }> => {
  const { data: contractor } = await admin
    .from("contractors")
    .select("free_jobs_remaining")
    .eq("id", contractorId)
    .maybeSingle();

  const { data: projection } = await admin
    .from("subscription_projection")
    .select("stripe_subscription_id, subscription_status")
    .eq("contractor_id", contractorId)
    .maybeSingle();

  if (!projection) return { ended: false, reason: "no-subscription" };

  const row = projection as Pick<
    SubscriptionProjection,
    "stripe_subscription_id" | "subscription_status"
  >;

  if (
    !shouldEndTrial({
      freeJobsRemaining:
        (contractor as { free_jobs_remaining: number | null } | null)
          ?.free_jobs_remaining ?? 0,
      subscriptionStatus: row.subscription_status,
    })
  ) {
    return { ended: false, reason: "not-exhausted-or-not-trialing" };
  }

  try {
    // `trial_end: "now"` is what makes billing start on allowance rather than on
    // elapsed time. The subscription was created with an open-ended trial for
    // exactly this moment.
    await stripe.subscriptions.update(row.stripe_subscription_id, {
      trial_end: "now",
    });
  } catch (err) {
    // Deliberately swallowed — see the note above. The webhook that follows a
    // successful update is what moves the projection to `active`; nothing here
    // writes the status locally.
    console.error(
      `[subscription_trial_end_failed] contractor=${contractorId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { ended: false, reason: "stripe-error" };
  }

  return { ended: true };
};
