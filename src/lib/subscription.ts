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
 * Whether the trade is locked out of CREATING work.
 *
 * Supersedes `isSubscriptionReadOnly` at the call sites, and exists alongside it
 * rather than replacing it because that predicate answers a narrower question —
 * "did a payment fail?" — which `tests/acceptance/659.test.ts` freezes, including
 * `isSubscriptionReadOnly("canceled") === false`. That assertion stays true. This
 * is the broader question the product actually needs answered, and it takes the
 * whole projection rather than a bare status string.
 *
 * Three restricted states, and the third is the one SUB-4 never covered:
 *
 *   past_due / unpaid — a payment failed. Adding a card in Settings → Billing
 *     restores access, which is what the lockout copy tells them to do.
 *
 *   canceled — the subscription has ENDED. Before this, a cancelled trade kept
 *     creating quotes, contracts and invoices for free, indefinitely: `canceled`
 *     was gated nowhere in the app. Signed contracts, invoices and job history
 *     stay readable, which is exactly what the cancel confirmation promises.
 *
 * `cancel_at_period_end` is deliberately NOT restricted — access continues to the
 * end of the paid period, and banked referral credits push Stripe's own `cancel_at`
 * further out (see `cancelSubscription`), so `canceled` does not arrive until the
 * extended access is genuinely spent. Stripe stays the source of truth for when
 * access ends; nothing here computes it locally.
 *
 * A null or absent status stays permissive. That is every contractor who predates
 * SUB-1, and locking them out on a missing row would be a far worse failure than
 * the leak it closes.
 */
export const isAccessRestricted = (status: string | null): boolean =>
  isSubscriptionReadOnly(status) || status === "canceled";

/**
 * What to tell a restricted trade, which is NOT the same sentence in both cases.
 *
 * "Your subscription payment failed" was the only message, and it was hard-coded
 * identically at three call sites. Saying that to someone who cancelled on
 * purpose is simply false, and it sends them to fix a card that is fine. One
 * function so the three sites cannot drift apart again.
 */
export const accessRestrictedMessage = (status: string | null): string =>
  status === "canceled"
    ? "Your subscription has ended. Restart it in Settings → Subscription to create new quotes, contracts and invoices. Your existing work stays available."
    : "Your subscription payment failed. Update your card details in Settings → Billing to restore access.";

/**
 * Whether the subscription is canceled (already ended).
 */
export const isCanceled = (projection: SubscriptionProjection): boolean =>
  projection.subscription_status === "canceled";

/**
 * Whether the subscription is cancelling (cancel_at_period_end is true, but
 * the period has not ended yet).
 */
export const isCancelling = (projection: SubscriptionProjection): boolean =>
  projection.subscription_status === "cancel_at_period_end";

/**
 * Whether the subscription grants active access. Returns true for active,
 * trialing, and cancel_at_period_end (access continues until period end).
 */
export const hasActiveSubscription = (projection: SubscriptionProjection): boolean =>
  projection.subscription_status === "active" ||
  projection.subscription_status === "trialing" ||
  projection.subscription_status === "cancel_at_period_end";

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

/**
 * Whether the allowance-spent panel still has anything to ask for, judged on
 * local state alone.
 *
 * Split from `shouldShowAllowanceSpentPanel` so the dashboard can decide whether
 * to spend a Stripe call at all: a trade who fails any of these never triggers
 * the card lookup, which is everyone who has free jobs left.
 */
export const allowanceSpentUnbilled = (input: {
  freeJobsRemaining: number;
  subscriptionStatus: string | null;
}): boolean =>
  input.freeJobsRemaining === 0 &&
  !isAccessRestricted(input.subscriptionStatus) &&
  input.subscriptionStatus !== "active";

/**
 * Whether to render the allowance-spent panel.
 *
 * THE `cardOnFile` TERM IS THE WHOLE POINT. Adding a card does NOT move the
 * subscription to `active`: `endTrialIfAllowanceExhausted` is called from the
 * settlement path and nowhere else, so the status stays `trialing` until the
 * next job is actually paid. Gating on status alone therefore left the panel up
 * after a trade had done exactly what it asked — still telling them "without
 * one, motko can't take payment and your account moves to view-only" when a card
 * was sitting on file. Reported from the device, 11 Sep.
 *
 * Ending the trial at card-add instead would fix the symptom by starting the
 * £9.99 earlier than D18 says it may ("billing starts when the three free jobs
 * are used"), so the money path is deliberately untouched here — this changes
 * only what the dashboard says.
 *
 * Failing closed (`cardOnFile: false` when Stripe cannot be reached) shows the
 * panel, which invites a harmless re-add rather than falsely reassuring. That is
 * the same posture Settings → Billing takes on the same question.
 */
export const shouldShowAllowanceSpentPanel = (input: {
  freeJobsRemaining: number;
  subscriptionStatus: string | null;
  cardOnFile: boolean;
}): boolean => allowanceSpentUnbilled(input) && !input.cardOnFile;

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

  // Far-future rather than a duration: the trial ends on allowance, and nothing
  // should end it on a clock. Stripe requires a concrete timestamp, so
  // "open-ended" is expressed as one as far out as Stripe permits.
  //
  // Bound to a local BEFORE the call so the same value goes into the request and
  // the idempotency key. Calling `openEndedTrialEnd()` twice would risk two
  // different values if the call straddled midnight UTC — which is the whole
  // failure this key derivation exists to avoid.
  const trialEnd = openEndedTrialEnd();

  const subscription = await stripe.subscriptions.create(
    {
      customer: customer.id,
      items: [{ price: input.priceId }],
      trial_end: trialEnd,
      metadata: { contractor_id: input.contractorId },
    },
    // THE KEY IS DERIVED FROM THE REQUEST — every parameter that can vary.
    //
    // Stripe stores the parameters against the key and refuses a reuse carrying
    // different ones:
    //
    //   Keys for idempotent requests can only be used with the same parameters
    //   they were first used with.
    //
    // So a key narrower than the request LOCKS OUT the correction of any
    // mistake in it, for the whole 24-hour window. That is not hypothetical: on
    // 10 Sep the same eleven contractors were locked out three times running,
    // each time by the previous attempt's key —
    //
    //   keyed on contractor        → burned by a product id in the price var
    //   + price                    → burned by a 5×365-day trial_end
    //   + price + trial_end        → correctable, which is this
    //
    // Each fix changed a parameter and re-burned a key that did not name it.
    // Deriving the key from `contractor + price + trial_end` ends the pattern,
    // because those are the only parameters that vary: `customer` is fixed per
    // contractor and `metadata` is constant.
    //
    // The protection that matters is untouched. `persistContractorSetup` calls
    // this on every AUTOSAVE of the manual setup form, and two autosaves seconds
    // apart produce an identical key — same contractor, same configured price,
    // same trial_end, since that is anchored to midnight UTC. They still
    // collapse to one subscription rather than billing a trade twice.
    //
    // ADDING A PARAMETER TO THE REQUEST ABOVE MEANS ADDING IT HERE. Anything
    // that can differ between two calls and is not in this key reproduces the
    // lockout exactly.
    {
      idempotencyKey: `subscription-create:${input.contractorId}:${input.priceId}:${trialEnd}`,
    },
  );

  return { created: true, subscriptionId: subscription.id };
};

/**
 * The open-ended trial's length. See OPEN_ENDED_TRIAL_SECONDS for the two
 * separate Stripe ceilings this has to sit under.
 *
 * 1 January 2100 was here until 10 Sep 2026, and it made EVERY subscription
 * creation fail. SUB-1 shipped 6 Sep and `subscription_projection` was empty
 * across the whole production database for four days because of it — the error
 * was invisible, since `persistContractorSetup` wraps the call in
 * `catch { console.warn }`.
 */
const SECONDS_PER_DAY = 24 * 60 * 60;
const MILLISECONDS_PER_DAY = SECONDS_PER_DAY * 1000;

/**
 * Stripe caps a trial at 730 days. 729 leaves a day of margin.
 *
 * TWO different ceilings, discovered a day apart, and the first one hid the
 * second. `trial_end: 4_102_444_800` (1 Jan 2100) was rejected as
 *
 *   Invalid timestamp: can be no more than five years in the future.
 *
 * so five years looked like the limit and this was set to 5 × 365 days. That
 * passes the timestamp check and then fails a SEPARATE one on trial LENGTH:
 *
 *   The maximum number of trial period days is 730 (2 years).
 *
 * A community answer naming two years was noted as unresolved when the
 * five-year value shipped, precisely because the live error had said five and
 * nothing in the API reference settled it. The backfill settled it.
 */
const OPEN_ENDED_TRIAL_SECONDS = 729 * SECONDS_PER_DAY;

/**
 * The trial timestamp to create a subscription with.
 *
 * Computed per call rather than a constant, because Stripe's ceiling is
 * relative to the moment of the request: a fixed stamp drifts toward it and
 * would eventually start failing again, which is the failure mode being fixed
 * here. `Math.floor` matters — `Date.now()` is milliseconds and Stripe rejects
 * a non-integer timestamp.
 *
 * ANCHORED TO MIDNIGHT UTC, and that is load-bearing rather than tidiness.
 *
 * `subscriptions.create` is called with a fixed idempotency key, which
 * `persistContractorSetup` relies on because the manual setup form calls it on
 * every AUTOSAVE. Stripe stores the request PARAMETERS against that key and
 * refuses a later request that reuses the key with different ones:
 *
 *   Keys for idempotent requests can only be used with the same parameters
 *   they were first used with.
 *
 * A stamp built from `Date.now()` in seconds differs on every call, so two
 * autosaves a second apart would send two different `trial_end` values under
 * one key — and the second would fail. That is not hypothetical: it is what
 * this returned between 10 Sep and this commit, and the previous fixed constant
 * is what had been hiding it. Quantising to the day makes every call within the
 * same UTC day byte-identical, which is what the key needs.
 *
 * Rounding DOWN also moves the stamp slightly earlier, never later, so it stays
 * comfortably inside Stripe's five-year ceiling.
 *
 * D18 is unchanged by this. The trial still ends on the free-job allowance and
 * never on a clock: `endTrialIfAllowanceExhausted` moves it to `now` on the
 * third completed job, long before this stamp is reachable. Only a contractor
 * who completes fewer than three paid jobs in five years would meet it, and
 * Jacob accepted that residual explicitly on 10 Sep — see areas/motko.md.
 */
export const openEndedTrialEnd = (): number =>
  Math.floor(Date.now() / MILLISECONDS_PER_DAY) * SECONDS_PER_DAY + OPEN_ENDED_TRIAL_SECONDS;

/**
 * Whether motko can actually charge this customer.
 *
 * Reads `invoice_settings.default_payment_method`, which is what Stripe bills a
 * subscription against. A payment method merely ATTACHED to the customer is not
 * enough — Stripe will not reach for it on its own — so this deliberately checks
 * the default rather than listing payment methods, and `attachPaymentMethod` sets
 * that default explicitly for the same reason.
 *
 * A deleted customer returns false rather than throwing: Stripe's retrieve
 * resolves for a deleted customer with `{ deleted: true }` and no
 * `invoice_settings` at all, and the honest answer there is "cannot charge".
 */
export const hasPaymentMethodOnFile = async (
  stripe: Pick<Stripe, "customers">,
  customerId: string,
): Promise<boolean> => {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return false;
  return Boolean(customer.invoice_settings?.default_payment_method);
};

/**
 * Makes a payment method the one motko bills, on BOTH objects.
 *
 * The customer default is what `hasPaymentMethodOnFile` reads and what a future
 * subscription would inherit; the subscription default is what this trade's
 * existing subscription actually charges. Setting only the customer leaves a
 * subscription created earlier still pointing at nothing, which is the shape of
 * bug that produces a `past_due` nobody can explain.
 */
export const attachPaymentMethod = async (
  stripe: Pick<Stripe, "customers" | "subscriptions">,
  input: { customerId: string; subscriptionId: string | null; paymentMethodId: string },
): Promise<void> => {
  await stripe.customers.update(input.customerId, {
    invoice_settings: { default_payment_method: input.paymentMethodId },
  });

  if (input.subscriptionId) {
    await stripe.subscriptions.update(input.subscriptionId, {
      default_payment_method: input.paymentMethodId,
    });
  }
};

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
  stripe: Pick<Stripe, "subscriptions" | "customers">,
  contractorId: string,
): Promise<{ ended: boolean; reason?: string }> => {
  const { data: contractor } = await admin
    .from("contractors")
    .select("free_jobs_remaining")
    .eq("id", contractorId)
    .maybeSingle();

  const { data: projection } = await admin
    .from("subscription_projection")
    .select("stripe_subscription_id, stripe_customer_id, subscription_status")
    .eq("contractor_id", contractorId)
    .maybeSingle();

  if (!projection) return { ended: false, reason: "no-subscription" };

  const row = projection as Pick<
    SubscriptionProjection,
    "stripe_subscription_id" | "stripe_customer_id" | "subscription_status"
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

  // THE SAFETY CATCH. Ending the trial with no card on file does not collect
  // £9.99 — it manufactures a dead end.
  //
  // Stripe raises the first invoice, has nothing to charge, and moves the
  // subscription to `past_due`. `isAccessRestricted` then locks the trade out of
  // creating quotes, contracts and invoices, and the lockout copy sends them to
  // Settings → Billing to fix it. So the trade is stopped, motko collects
  // nothing, and the only route out is the one the app must offer.
  //
  // So the allowance being spent is NECESSARY but not SUFFICIENT. The trial holds
  // open until a card exists, and `shouldEndTrial` stays true meanwhile, so the
  // next completed job retries this and the trial ends the moment one is added.
  // Meanwhile the dashboard shows the allowance-spent overlay, which is where the
  // card actually gets added.
  //
  // Read live from Stripe rather than cached: this runs only once the allowance
  // is spent, so it costs one API call for the trades who have reached the
  // decision point and nothing for anyone else — cheaper than a column that
  // could go stale against the provider that owns the truth.
  const cardOnFile = await hasPaymentMethodOnFile(stripe, row.stripe_customer_id);
  if (!cardOnFile) {
    return { ended: false, reason: "no-payment-method" };
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
