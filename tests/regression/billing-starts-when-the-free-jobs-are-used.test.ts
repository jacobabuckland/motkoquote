// Adding a card starts the billing the Settings copy promises.
//
// Settings → Billing has always said: "Motko charges it £9.99 a month once your
// three free jobs are used." The code did something else — the trial was ended
// by `endTrialIfAllowanceExhausted`, which was called from the SETTLEMENT path
// and nowhere else. So a trade whose allowance was already spent could add a
// card and be charged nothing until their next paid job, weeks later.
//
// Found on Jacob's own account on 11 Sep: allowance spent, card on file, nothing
// charged. He confirmed the Settings copy is the truth, so the card-added
// webhook now calls the same function. The RULE is unchanged and still lives in
// `endTrialIfAllowanceExhausted`; only the call site is new — which is why the
// second test here matters at least as much as the first.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

let freeJobsRemaining: number;
let subscriptionStatus: string;
let defaultPaymentMethod: string | null;

const constructEvent = vi.fn();
const customersUpdate = vi.fn(async (_id?: string, _params?: unknown) => ({}));
const subscriptionsUpdate = vi.fn(async (_id?: string, _params?: unknown) => ({}));

vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent },
    setupIntents: {
      retrieve: async (_id?: string) => ({ payment_method: "pm_new" }),
    },
    customers: {
      update: customersUpdate,
      // What `hasPaymentMethodOnFile` reads. The attach above is what sets it,
      // which is why the trial-end call has to come after.
      retrieve: async (_id?: string) => ({
        deleted: false,
        invoice_settings: { default_payment_method: defaultPaymentMethod },
      }),
    },
    subscriptions: { update: subscriptionsUpdate },
  }),
}));

vi.mock("@/lib/settle-paid-job", () => ({ settlePaidJob: async () => {} }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async (): Promise<{ data: Row | null; error: null }> => ({
            data:
              table === "contractors"
                ? { free_jobs_remaining: freeJobsRemaining }
                : {
                    stripe_subscription_id: "sub_1",
                    stripe_customer_id: "cus_1",
                    subscription_status: subscriptionStatus,
                  },
            error: null,
          }),
        }),
      }),
      upsert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

const cardAddedEvent = {
  id: "evt_card",
  type: "checkout.session.completed",
  created: 1_760_000_000,
  data: {
    object: {
      mode: "setup",
      setup_intent: "seti_1",
      customer: "cus_1",
      metadata: { contractor_id: "ctr_1" },
    },
  },
};

const postCardAdded = async () => {
  constructEvent.mockReturnValue(cardAddedEvent);
  const { POST } = await import("@/app/api/stripe/webhook/route");
  return POST(
    new Request("https://motko.app/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    }) as never,
  );
};

/** The `trial_end: "now"` call, which is what actually starts the billing. */
const trialEndCalls = () =>
  subscriptionsUpdate.mock.calls.filter(
    (call) => (call[1] as { trial_end?: string } | undefined)?.trial_end === "now",
  );

beforeEach(() => {
  vi.clearAllMocks();
  // Without this the route returns 500 before it does anything — and the
  // "charges nothing" assertions below then pass for the wrong reason, which is
  // how the first draft of this file looked green while testing nothing.
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  subscriptionsUpdate.mockImplementation(async (_id?: string, _params?: unknown) => ({}));
  freeJobsRemaining = 0;
  subscriptionStatus = "trialing";
  defaultPaymentMethod = "pm_new";
});

describe("adding a card, once the free jobs are used", () => {
  it("starts the billing there and then, rather than at the next paid job", async () => {
    const response = await postCardAdded();

    expect(response.status).toBe(200);
    expect(trialEndCalls()).toHaveLength(1);
    expect(trialEndCalls()[0][0]).toBe("sub_1");
  });

  it("attaches the card as well — the trial end does not replace it", async () => {
    await postCardAdded();

    expect(customersUpdate).toHaveBeenCalledWith("cus_1", {
      invoice_settings: { default_payment_method: "pm_new" },
    });
  });
});

describe("adding a card while free jobs remain", () => {
  it("charges NOTHING — the allowance term is what protects this", async () => {
    // "A trade with unused free jobs is never charged" is an acceptance
    // criterion, and the new call site must not become the way around it.
    freeJobsRemaining = 2;

    await postCardAdded();

    expect(trialEndCalls()).toHaveLength(0);
  });

  it("still attaches the card, so the next job has something to charge", async () => {
    freeJobsRemaining = 2;

    await postCardAdded();

    expect(customersUpdate).toHaveBeenCalledWith("cus_1", {
      invoice_settings: { default_payment_method: "pm_new" },
    });
  });
});

describe("what the new call site must not disturb", () => {
  it("leaves a trade who is already billing alone", async () => {
    // Idempotence. The webhook fires again when a trade REPLACES their card, and
    // an active subscription must not be re-trial-ended.
    subscriptionStatus = "active";

    await postCardAdded();

    expect(trialEndCalls()).toHaveLength(0);
  });

  it("never revives a cancelled subscription", async () => {
    subscriptionStatus = "canceled";

    await postCardAdded();

    expect(trialEndCalls()).toHaveLength(0);
  });

  it("does not end the trial if the card somehow did not become the default", async () => {
    // Ending a trial with nothing to charge manufactures a dead end: Stripe
    // raises an invoice it cannot collect and moves the trade to `past_due`,
    // which locks them out. Motko collects nothing and the trade is stopped.
    defaultPaymentMethod = null;

    await postCardAdded();

    expect(trialEndCalls()).toHaveLength(0);
  });

  it("still returns 200 when the trial end fails, because the card IS attached", async () => {
    // A 500 makes Stripe redeliver, and the thing a redelivery exists to secure
    // — the attach — has already happened. The settlement path still calls this
    // too, so a failure here is retried on the next paid job as it always was.
    subscriptionsUpdate.mockImplementation(async (_id?: string, params?: unknown) => {
      if ((params as { trial_end?: string } | undefined)?.trial_end === "now") {
        throw new Error("Stripe is unreachable");
      }
      return {};
    });

    const response = await postCardAdded();

    expect(response.status).toBe(200);
    expect(customersUpdate).toHaveBeenCalled();
  });
});
