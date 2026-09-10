import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import {
  applySubscriptionEvent,
  createSubscriptionForContractor,
  openEndedTrialEnd,
  endTrialIfAllowanceExhausted,
  projectSubscriptionEvent,
  shouldEndTrial,
  toSubscriptionEvent,
  type SubscriptionEvent,
  type SubscriptionProjection,
} from "@/lib/subscription";

const projection = (
  overrides: Partial<SubscriptionProjection> = {},
): SubscriptionProjection => ({
  contractor_id: "ctr-1",
  stripe_subscription_id: "sub_1",
  stripe_customer_id: "cus_1",
  subscription_status: "trialing",
  trial_end: null,
  last_event_id: "evt_100",
  last_event_created: 1_000,
  ...overrides,
});

const event = (overrides: Partial<SubscriptionEvent> = {}): SubscriptionEvent => ({
  id: "evt_101",
  created: 1_001,
  subscriptionId: "sub_1",
  customerId: "cus_1",
  status: "active",
  trialEnd: null,
  contractorId: "ctr-1",
  ...overrides,
});

describe("projectSubscriptionEvent", () => {
  it("applies the first event for a subscription", () => {
    const decision = projectSubscriptionEvent(null, event(), "ctr-1");

    expect(decision.apply).toBe(true);
    if (decision.apply) {
      expect(decision.row.subscription_status).toBe("active");
      expect(decision.row.last_event_id).toBe("evt_101");
      expect(decision.row.contractor_id).toBe("ctr-1");
    }
  });

  it("drops a replay of the event already applied", () => {
    // Stripe redelivers on any non-2xx, and redelivers events it has already
    // delivered successfully. The stored event id is what makes that a no-op.
    const decision = projectSubscriptionEvent(
      projection({ last_event_id: "evt_101", last_event_created: 1_001 }),
      event({ id: "evt_101", created: 1_001 }),
      "ctr-1",
    );

    expect(decision).toEqual({ apply: false, reason: "replay" });
  });

  it("drops an event created before the one already applied", () => {
    // The failure this prevents: a stale `active` arriving after `canceled` and
    // quietly reviving a cancelled subscription.
    const decision = projectSubscriptionEvent(
      projection({ subscription_status: "canceled", last_event_created: 2_000 }),
      event({ id: "evt_099", created: 1_500, status: "active" }),
      "ctr-1",
    );

    expect(decision).toEqual({ apply: false, reason: "out-of-order" });
  });

  it("applies a same-second event, in arrival order", () => {
    // Stripe stamps `created` in whole seconds and can emit several within one.
    // Strictly-older is what loses, so a same-second event is not dropped —
    // dropping it would lose legitimate transitions.
    const decision = projectSubscriptionEvent(
      projection({ last_event_created: 1_000, last_event_id: "evt_100" }),
      event({ id: "evt_101", created: 1_000, status: "active" }),
      "ctr-1",
    );

    expect(decision.apply).toBe(true);
  });

  it("survives a replay of an OLD event after a newer one landed", () => {
    // The two guards compose: this is both a replay of evt_100 and older than
    // what is stored. Either rule alone would drop it; both must.
    const current = projection({ last_event_id: "evt_200", last_event_created: 5_000 });

    expect(
      projectSubscriptionEvent(current, event({ id: "evt_100", created: 1_000 }), "ctr-1"),
    ).toEqual({ apply: false, reason: "out-of-order" });
  });

  it("carries trial_end through as the unix seconds Stripe sent", () => {
    const decision = projectSubscriptionEvent(null, event({ trialEnd: 1_767_225_600 }), "ctr-1");

    expect(decision.apply).toBe(true);
    if (decision.apply) {
      // bigint in the database, not a timestamp — asserted so a future change to
      // a Date cannot pass silently.
      expect(decision.row.trial_end).toBe(1_767_225_600);
      expect(typeof decision.row.trial_end).toBe("number");
    }
  });
});

describe("shouldEndTrial", () => {
  it("does not end the trial while free jobs remain", () => {
    // "A trade with unused free jobs is never charged" — the item's own AC.
    for (const freeJobsRemaining of [3, 2, 1]) {
      expect(shouldEndTrial({ freeJobsRemaining, subscriptionStatus: "trialing" })).toBe(false);
    }
  });

  it("ends the trial when the allowance is exhausted", () => {
    expect(shouldEndTrial({ freeJobsRemaining: 0, subscriptionStatus: "trialing" })).toBe(true);
  });

  it("treats a negative balance as exhausted", () => {
    // The cache can drift negative between settlements; the nightly reconcile
    // corrects it. Exhausted is exhausted in the meantime.
    expect(shouldEndTrial({ freeJobsRemaining: -1, subscriptionStatus: "trialing" })).toBe(true);
  });

  it("is idempotent once the subscription is active", () => {
    // Jobs four, five and six all arrive with the allowance at zero. Only the
    // first should reach Stripe.
    expect(shouldEndTrial({ freeJobsRemaining: 0, subscriptionStatus: "active" })).toBe(false);
  });

  it("never revives a cancelled subscription", () => {
    expect(shouldEndTrial({ freeJobsRemaining: 0, subscriptionStatus: "canceled" })).toBe(false);
  });

  it("does nothing when there is no subscription status at all", () => {
    expect(shouldEndTrial({ freeJobsRemaining: 0, subscriptionStatus: null })).toBe(false);
  });
});

describe("toSubscriptionEvent", () => {
  it("reads the contractor from subscription metadata", () => {
    const narrowed = toSubscriptionEvent(
      { id: "evt_1", created: 1_234 },
      {
        id: "sub_9",
        customer: "cus_9",
        status: "trialing",
        trial_end: null,
        metadata: { contractor_id: "ctr-9" },
      } as unknown as Stripe.Subscription,
    );

    expect(narrowed).toEqual({
      id: "evt_1",
      created: 1_234,
      subscriptionId: "sub_9",
      customerId: "cus_9",
      status: "trialing",
      trialEnd: null,
      contractorId: "ctr-9",
    });
  });

  it("handles an expanded customer object as well as an id", () => {
    const narrowed = toSubscriptionEvent(
      { id: "evt_2", created: 1 },
      {
        id: "sub_9",
        customer: { id: "cus_expanded" },
        status: "active",
        trial_end: 42,
        metadata: {},
      } as unknown as Stripe.Subscription,
    );

    expect(narrowed.customerId).toBe("cus_expanded");
    expect(narrowed.contractorId).toBeNull();
  });
});

/**
 * A Supabase stub covering the shapes this module uses: a chainable select that
 * resolves through maybeSingle, and an upsert that records what it wrote.
 *
 * Written locally rather than with `tests/helpers/supabase.ts` because that
 * helper covers reads only — `from()` returns just `{ select }` and ignores the
 * table name, so it cannot serve two tables in one test nor record a write.
 * Extending it is the follow-up noted on FACT-3.
 */
const buildStub = (tables: Record<string, unknown | null>) => {
  const upserts: { table: string; row: Record<string, unknown> }[] = [];
  const updates: { table: string; patch: Record<string, unknown> }[] = [];

  const from = vi.fn((table?: string) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({
        data: tables[table ?? ""] ?? null,
        error: null,
      })),
      upsert: vi.fn(async (row?: Record<string, unknown>) => {
        upserts.push({ table: table ?? "", row: row ?? {} });
        return { error: null };
      }),
      update: vi.fn((patch?: Record<string, unknown>) => {
        updates.push({ table: table ?? "", patch: patch ?? {} });
        return chain;
      }),
    };
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, upserts, updates, from };
};

describe("applySubscriptionEvent", () => {
  it("writes the projection for a first event", async () => {
    const stub = buildStub({ subscription_projection: null });

    const decision = await applySubscriptionEvent(stub.client, event());

    expect(decision.apply).toBe(true);
    expect(stub.upserts).toHaveLength(1);
    expect(stub.upserts[0]?.row).toMatchObject({
      contractor_id: "ctr-1",
      stripe_subscription_id: "sub_1",
      subscription_status: "active",
      last_event_id: "evt_101",
    });
  });

  it("writes nothing on a replay", async () => {
    const stub = buildStub({
      subscription_projection: projection({ last_event_id: "evt_101", last_event_created: 1_001 }),
    });

    const decision = await applySubscriptionEvent(stub.client, event({ id: "evt_101", created: 1_001 }));

    expect(decision).toEqual({ apply: false, reason: "replay" });
    expect(stub.upserts).toHaveLength(0);
  });

  it("writes nothing for an out-of-order event", async () => {
    const stub = buildStub({
      subscription_projection: projection({ subscription_status: "canceled", last_event_created: 9_000 }),
    });

    const decision = await applySubscriptionEvent(stub.client, event({ created: 1_000 }));

    expect(decision).toEqual({ apply: false, reason: "out-of-order" });
    expect(stub.upserts).toHaveLength(0);
  });

  it("falls back to the existing row when metadata carries no contractor", async () => {
    // A subscription created before this code, or by hand in the dashboard.
    const stub = buildStub({ subscription_projection: projection() });

    const decision = await applySubscriptionEvent(
      stub.client,
      event({ contractorId: null, id: "evt_999", created: 9_999 }),
    );

    expect(decision.apply).toBe(true);
    expect(stub.upserts[0]?.row).toMatchObject({ contractor_id: "ctr-1" });
  });

  it("drops an event it cannot attribute to a contractor", async () => {
    const stub = buildStub({ subscription_projection: null });

    const decision = await applySubscriptionEvent(stub.client, event({ contractorId: null }));

    expect(decision).toEqual({ apply: false, reason: "unknown-contractor" });
    expect(stub.upserts).toHaveLength(0);
  });
});

describe("endTrialIfAllowanceExhausted", () => {
  // `cardOnFile` defaults to true so the existing cases below still exercise the
  // path they were written for. The guard added on 10 Sep only diverts when the
  // customer has no default payment method, which its own case covers.
  const stripeStub = (cardOnFile = true) => {
    const update = vi.fn(async (_id?: string, _params?: unknown) => ({}));
    const retrieve = vi.fn(async (_id?: string) => ({
      deleted: false,
      invoice_settings: {
        default_payment_method: cardOnFile ? "pm_1" : null,
      },
    }));
    return {
      update,
      retrieve,
      stripe: { subscriptions: { update }, customers: { retrieve } } as unknown as Pick<
        Stripe,
        "customers" | "subscriptions"
      >,
    };
  };

  it("ends the trial once the allowance is spent", async () => {
    const stub = buildStub({
      contractors: { free_jobs_remaining: 0 },
      subscription_projection: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", subscription_status: "trialing" },
    });
    const { update, stripe } = stripeStub();

    const result = await endTrialIfAllowanceExhausted(stub.client, stripe, "ctr-1");

    expect(result).toEqual({ ended: true });
    expect(update).toHaveBeenCalledWith("sub_1", { trial_end: "now" });
  });

  it("leaves a trade with free jobs alone", async () => {
    const stub = buildStub({
      contractors: { free_jobs_remaining: 1 },
      subscription_projection: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", subscription_status: "trialing" },
    });
    const { update, stripe } = stripeStub();

    const result = await endTrialIfAllowanceExhausted(stub.client, stripe, "ctr-1");

    expect(result.ended).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("does not call Stripe twice once the subscription is active", async () => {
    const stub = buildStub({
      contractors: { free_jobs_remaining: 0 },
      subscription_projection: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", subscription_status: "active" },
    });
    const { update, stripe } = stripeStub();

    await endTrialIfAllowanceExhausted(stub.client, stripe, "ctr-1");

    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing when the trade has no subscription", async () => {
    const stub = buildStub({ contractors: { free_jobs_remaining: 0 }, subscription_projection: null });
    const { update, stripe } = stripeStub();

    const result = await endTrialIfAllowanceExhausted(stub.client, stripe, "ctr-1");

    expect(result).toEqual({ ended: false, reason: "no-subscription" });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a Stripe failure without throwing", async () => {
    // A completed job must not fail because Stripe is briefly unreachable. The
    // allowance stays at zero and the status stays `trialing`, so the next
    // completed job retries.
    const stub = buildStub({
      contractors: { free_jobs_remaining: 0 },
      subscription_projection: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", subscription_status: "trialing" },
    });
    const update = vi.fn(async (_id?: string, _params?: unknown) => {
      throw new Error("stripe down");
    });
    const retrieve = vi.fn(async (_id?: string) => ({
      deleted: false,
      invoice_settings: { default_payment_method: "pm_1" },
    }));
    const stripe = { subscriptions: { update }, customers: { retrieve } } as unknown as Pick<
      Stripe,
      "customers" | "subscriptions"
    >;

    const result = await endTrialIfAllowanceExhausted(stub.client, stripe, "ctr-1");

    expect(result).toEqual({ ended: false, reason: "stripe-error" });
  });

  it("does NOT end the trial when there is no card on file", async () => {
    // THE DEAD END this guard exists to prevent. Ending the trial here does not
    // collect £9.99 — Stripe raises an invoice, has nothing to charge, and moves
    // the subscription to past_due, which locks the trade out of creating work
    // while motko collects nothing.
    const stub = buildStub({
      contractors: { free_jobs_remaining: 0 },
      subscription_projection: {
        stripe_subscription_id: "sub_1",
        stripe_customer_id: "cus_1",
        subscription_status: "trialing",
      },
    });
    const { update, stripe } = stripeStub(false);

    const result = await endTrialIfAllowanceExhausted(stub.client, stripe, "ctr-1");

    expect(result).toEqual({ ended: false, reason: "no-payment-method" });
    // The load-bearing half: Stripe was never asked to end anything.
    expect(update).not.toHaveBeenCalled();
  });

  it("ends the trial on a later job once a card has been added", async () => {
    // The guard holds the trial open rather than abandoning it. shouldEndTrial
    // stays true while the allowance is spent and the status is still trialing,
    // so the next completed job retries and bills correctly.
    const stub = buildStub({
      contractors: { free_jobs_remaining: 0 },
      subscription_projection: {
        stripe_subscription_id: "sub_1",
        stripe_customer_id: "cus_1",
        subscription_status: "trialing",
      },
    });

    const withoutCard = stripeStub(false);
    expect(await endTrialIfAllowanceExhausted(stub.client, withoutCard.stripe, "ctr-1")).toEqual({
      ended: false,
      reason: "no-payment-method",
    });

    const withCard = stripeStub(true);
    expect(await endTrialIfAllowanceExhausted(stub.client, withCard.stripe, "ctr-1")).toEqual({
      ended: true,
    });
    expect(withCard.update).toHaveBeenCalledWith("sub_1", { trial_end: "now" });
  });
});

describe("createSubscriptionForContractor", () => {
  const stripeStub = () => {
    const customers = { create: vi.fn(async (_p?: unknown, _o?: unknown) => ({ id: "cus_new" })) };
    const subscriptions = { create: vi.fn(async (_p?: unknown, _o?: unknown) => ({ id: "sub_new" })) };
    return {
      customers,
      subscriptions,
      stripe: { customers, subscriptions } as unknown as Pick<Stripe, "customers" | "subscriptions">,
    };
  };

  const args = {
    contractorId: "ctr-1",
    email: "trade@example.com",
    companyName: "Smith Plumbing",
    priceId: "price_999",
  };

  it("creates the subscription with an open-ended trial", async () => {
    const stub = buildStub({ subscription_projection: null });
    const s = stripeStub();

    const result = await createSubscriptionForContractor(stub.client, s.stripe, args);

    expect(result).toEqual({ created: true, subscriptionId: "sub_new" });
    // D18: the trial ends on allowance, never on a clock. A far-future stamp is
    // how "open-ended" is expressed, since Stripe has no unbounded trial.
    expect(s.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ trial_end: openEndedTrialEnd() }),
      expect.anything(),
    );
  });

  it("sends a trial_end Stripe will actually accept", async () => {
    // THE BUG. 1 Jan 2100 was sent here until 10 Sep 2026 and Stripe rejected
    // every call: "Invalid timestamp: can be no more than five years in the
    // future." Nobody in production had a subscription for four days as a
    // result. Asserting the CEILING rather than a literal, so a future edit
    // that reaches past it fails here rather than in production.
    const stub = buildStub({ subscription_projection: null });
    const s = stripeStub();

    await createSubscriptionForContractor(stub.client, s.stripe, args);

    const sent = s.subscriptions.create.mock.calls[0][0] as { trial_end: number };
    const now = Math.floor(Date.now() / 1000);
    const day = 24 * 60 * 60;

    // TWO ceilings, and the first hid the second. A far-future stamp is
    // rejected as "no more than five years in the future"; a trial longer than
    // 730 days is separately rejected as "The maximum number of trial period
    // days is 730 (2 years)". 729 days sits under both.
    expect(sent.trial_end).toBeLessThan(now + 730 * day);
    // And still far enough out that the allowance, not the clock, ends it.
    expect(sent.trial_end).toBeGreaterThan(now + 700 * day);
    expect(Number.isInteger(sent.trial_end)).toBe(true);
  });

  it("tags both objects with the contractor, which is the webhook's only link", async () => {
    const stub = buildStub({ subscription_projection: null });
    const s = stripeStub();

    await createSubscriptionForContractor(stub.client, s.stripe, args);

    expect(s.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { contractor_id: "ctr-1" } }),
      expect.anything(),
    );
    expect(s.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { contractor_id: "ctr-1" } }),
      expect.anything(),
    );
  });

  it("passes an idempotency key on both calls, keyed to the contractor", async () => {
    // This is what stops a second autosave creating a second subscription in the
    // window before the created-webhook lands and writes the projection row.
    const stub = buildStub({ subscription_projection: null });
    const s = stripeStub();

    await createSubscriptionForContractor(stub.client, s.stripe, args);

    expect(s.customers.create.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: "subscription-customer:ctr-1",
    });
    expect(s.subscriptions.create.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: `subscription-create:ctr-1:price_999:${openEndedTrialEnd()}`,
    });
  });

  it("keys on EVERY parameter that varies, so a correction is never locked out", async () => {
    // Three times running on 10 Sep the same eleven contractors were locked out
    // by the PREVIOUS attempt's key: contractor alone was burned by a bad price,
    // + price was burned by a bad trial_end. A key narrower than the request
    // makes any mistake in it uncorrectable for 24 hours.
    const s = stripeStub();
    await createSubscriptionForContractor(
      buildStub({ subscription_projection: null }).client,
      s.stripe,
      args,
    );

    const key = (s.subscriptions.create.mock.calls[0]?.[1] as { idempotencyKey: string })
      .idempotencyKey;
    const sent = s.subscriptions.create.mock.calls[0]?.[0] as {
      trial_end: number;
      items: { price: string }[];
    };

    // Every varying parameter of the request appears in the key.
    expect(key).toContain(args.contractorId);
    expect(key).toContain(sent.items[0].price);
    expect(key).toContain(String(sent.trial_end));
  });

  it("changes the subscription key when the PRICE changes", async () => {
    // Stripe stores the parameters against an idempotency key and rejects a
    // reuse that carries different ones. Keyed on the contractor alone, a
    // MISCONFIGURED price locks the contractor out for 24 hours even after the
    // configuration is corrected — which is exactly what stranded eleven
    // contractors on 10 Sep when the env var held a product id.
    const first = stripeStub();
    await createSubscriptionForContractor(
      buildStub({ subscription_projection: null }).client,
      first.stripe,
      { ...args, priceId: "price_wrong" },
    );

    const second = stripeStub();
    await createSubscriptionForContractor(
      buildStub({ subscription_projection: null }).client,
      second.stripe,
      { ...args, priceId: "price_right" },
    );

    expect(first.subscriptions.create.mock.calls[0]?.[1]).not.toEqual(
      second.subscriptions.create.mock.calls[0]?.[1],
    );
  });

  it("keeps ONE key across repeated calls with the same price", async () => {
    // The protection that matters is unchanged: the manual setup form calls
    // this on every autosave, and two calls seconds apart must still collapse
    // to one subscription rather than billing a trade twice.
    const a = stripeStub();
    await createSubscriptionForContractor(
      buildStub({ subscription_projection: null }).client,
      a.stripe,
      args,
    );

    const b = stripeStub();
    await createSubscriptionForContractor(
      buildStub({ subscription_projection: null }).client,
      b.stripe,
      args,
    );

    expect(a.subscriptions.create.mock.calls[0]?.[1]).toEqual(
      b.subscriptions.create.mock.calls[0]?.[1],
    );
    // And the PARAMETERS must match too, or Stripe rejects the reuse. This is
    // what a per-second trial_end broke: `openEndedTrialEnd` is anchored to
    // midnight UTC so every call within a day is byte-identical.
    expect(a.subscriptions.create.mock.calls[0]?.[0]).toEqual(
      b.subscriptions.create.mock.calls[0]?.[0],
    );
  });

  it("does not create a second subscription once one is projected", async () => {
    const stub = buildStub({ subscription_projection: { stripe_subscription_id: "sub_existing" } });
    const s = stripeStub();

    const result = await createSubscriptionForContractor(stub.client, s.stripe, args);

    expect(result).toEqual({
      created: false,
      subscriptionId: "sub_existing",
      reason: "already-subscribed",
    });
    expect(s.customers.create).not.toHaveBeenCalled();
    expect(s.subscriptions.create).not.toHaveBeenCalled();
  });
});
