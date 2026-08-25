// The webhook half of "deposited": recording that money left Stripe for a
// contractor's bank.
//
// The riskiest thing here is not the happy path. It is telling a CONTRACTOR's
// payout apart from the PLATFORM's own. Both arrive on the same endpoint —
// motko paying itself its fee income looks structurally identical to a trade
// being paid — and Stripe distinguishes them by putting the connected account
// id on the ENVELOPE (`event.account`), not in the payout body. Getting that
// wrong shows motko's fee income to a contractor as their own money.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

let contractorRow: Row | null;
let upserted: Row[];
let upsertError: { message: string } | null;

const constructEvent = vi.fn();

vi.mock("@/lib/stripe-client", () => ({
  getStripeClient: () => ({ webhooks: { constructEvent } }),
}));

vi.mock("@/lib/settle-paid-job", () => ({ settlePaidJob: async () => {} }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "contractors" ? contractorRow : null,
            error: null,
          }),
          single: async () => ({
            data: table === "contractors" ? contractorRow : null,
            error: null,
          }),
        }),
      }),
      upsert: async (row: Row) => {
        if (upsertError) return { error: upsertError };
        upserted.push(row);
        return { error: null };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

const post = async (event: unknown) => {
  constructEvent.mockReturnValue(event);
  const { POST } = await import("@/app/api/stripe/webhook/route");
  return POST(
    new Request("https://motko.app/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    }) as never,
  );
};

const payoutEvent = (over: Record<string, unknown> = {}) => ({
  type: "payout.paid",
  account: "acct_contractor",
  data: {
    object: {
      id: "po_123",
      amount: 41250,
      currency: "gbp",
      arrival_date: 1_787_788_800, // seconds, as Stripe sends it
      ...((over.object as Record<string, unknown>) ?? {}),
    },
  },
  ...over,
});

describe("recording a contractor payout", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    contractorRow = { id: "contractor-1" };
    upserted = [];
    upsertError = null;
  });

  it("records the amount, the state and Stripe's arrival estimate", async () => {
    const response = await post(payoutEvent());

    expect(response.status).toBe(200);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({
      contractor_id: "contractor-1",
      stripe_payout_id: "po_123",
      amount_pennies: 41250,
      status: "paid",
    });
    // Seconds to ISO. Without the arrival estimate the surface can only make
    // the bare "deposited" claim this whole state was designed to avoid.
    expect(upserted[0].arrival_date).toBe(
      new Date(1_787_788_800 * 1000).toISOString(),
    );
  });

  it("records a failed payout as failed, with the reason", async () => {
    await post(
      payoutEvent({
        type: "payout.failed",
        object: { failure_message: "Account closed" },
      }),
    );

    expect(upserted[0]).toMatchObject({
      status: "failed",
      failure_message: "Account closed",
    });
  });

  it("falls back to the failure code when Stripe sends no message", async () => {
    await post(
      payoutEvent({ type: "payout.failed", object: { failure_code: "account_closed" } }),
    );
    expect(upserted[0].failure_message).toBe("account_closed");
  });

  it("carries no failure message on a successful payout", async () => {
    await post(payoutEvent());
    expect(upserted[0].failure_message).toBeNull();
  });
});

describe("whose money it is", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    contractorRow = { id: "contractor-1" };
    upserted = [];
    upsertError = null;
  });

  it("ignores the platform's own payout, which has no connected account", async () => {
    // motko paying itself its fee income. Recording this against a contractor
    // would show them motko's revenue as their own money.
    const response = await post(payoutEvent({ account: undefined }));

    expect(response.status).toBe(200);
    expect(upserted, "the platform's own payout was recorded as a contractor's").toHaveLength(
      0,
    );
  });

  it("ignores a connected account we do not know, without erroring", async () => {
    // 200, not 500: a non-2xx makes Stripe retry forever for an account that
    // will never resolve.
    contractorRow = null;
    const response = await post(payoutEvent({ account: "acct_stranger" }));

    expect(response.status).toBe(200);
    expect(upserted).toHaveLength(0);
  });
});

describe("delivery guarantees", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    contractorRow = { id: "contractor-1" };
    upserted = [];
    upsertError = null;
  });

  it("asks Stripe to retry when the write fails", async () => {
    // Losing a payout record silently puts the trade back where they started,
    // told nothing about their money. A 500 is what makes Stripe try again.
    upsertError = { message: "connection reset" };
    const response = await post(payoutEvent());
    expect(response.status).toBe(500);
  });

  it("upserts on the payout id, so a retry cannot double-count", async () => {
    // Stripe retries delivery. Two rows for one payout would double a figure
    // on the one screen whose entire job is telling a trade what they received.
    const source = await import("node:fs").then((fs) =>
      fs.promises.readFile("src/app/api/stripe/webhook/route.ts", "utf-8"),
    );
    expect(source).toMatch(/onConflict:\s*"stripe_payout_id"/);
  });
});
