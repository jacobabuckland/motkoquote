/**
 * The re-issue warning promises the customer will be told. Nothing proved it.
 *
 * PASS-13 SERIOUS 3, the half the reviewer could not check from outside:
 *
 *   "they'll be told the quote has changed and asked to accept again"
 *
 * is what the editor tells the contractor before they save. From the
 * contractor's screen there is no evidence either way, and the reviewer said so
 * rather than guessing — correctly, because `announceReissue` swallows its own
 * errors by design (losing a notification must not lose the edit).
 *
 * The send DOES exist. What did not exist was any test of it: before this file,
 * `quote_reissued` appeared in exactly two places in the repository, both of
 * them source. A promise made to a customer, implemented in a try/catch, with
 * nothing asserting it fires, is one refactor away from being a lie.
 *
 * THIS DRIVES THE REAL SERVER ACTION. An earlier draft of this file mocked
 * `notifyCustomer` and then called the mock — which asserts that a stub records
 * what it was handed and proves nothing about the code under test. That is the
 * shape AGENTS.md calls out, and it would have passed just as happily against a
 * `updateQuoteLineItems` that never notified anybody.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mockSupabaseClient } from "../helpers/supabase";

type NotifyCall = { event?: string; amount?: number; previousAmount?: number };

const { notifyCalls } = vi.hoisted(() => ({ notifyCalls: [] as NotifyCall[] }));

// vi.hoisted, because a vi.mock factory is lifted above the file body and a
// plain top-level const sits in its temporal dead zone the first time the mock
// runs — surfacing as an empty call list rather than as itself.
vi.mock("@/lib/notify-customer", () => ({
  notifyCustomer: async (call?: NotifyCall) => {
    notifyCalls.push(call ?? {});
    return { delivered: true };
  },
}));

const UUID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  notifyCalls.length = 0;
  vi.resetModules();
});

const runReissue = async () => {
  // One row answers every lookup on the way through — the stub returns it for
  // contractors, jobs and quotes alike. `accepted` with no contract is the
  // state that makes a save a RE-ISSUE rather than an ordinary edit.
  const { client } = mockSupabaseClient([
    {
      id: UUID,
      owner_user_id: "user_1",
      job_id: UUID,
      status: "accepted",
      total: 840,
      sent_total: 600,
      contract: null,
      job: {
        id: UUID,
        customer: { name: "QA", contact: { email: "qa@example.com" } },
        contractor: { id: UUID, company_name: "ASPIRE PLASTERING LIMITED", vat_registered: false },
      },
    },
  ]);
  const authed = Object.assign(client, {
    auth: { getUser: async () => ({ data: { user: { id: "user_1" } }, error: null }) },
  });

  vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => authed }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));

  const mod = await import("@/app/jobs/actions");
  await mod
    .updateQuoteLineItems({ jobId: UUID, quoteId: UUID, lineItems: [] })
    .catch(() => null);
};

describe("saving an accepted quote tells the customer it changed", () => {
  it("sends the quote_reissued notification", async () => {
    await runReissue();

    const reissue = notifyCalls.find((c) => c.event === "quote_reissued");
    expect(
      reissue,
      "no quote_reissued notification was sent, though the editor promised the " +
        "customer would be told the quote had changed",
    ).toBeDefined();
  });

  it("carries the figure the customer was already told", async () => {
    // A customer holding two numbers with no idea which stands is the defect,
    // not the wording — reissue-notice.ts says so in terms. `previousAmount`
    // is `sent_total`: what they were sent, not what the row says now.
    //
    // `amount` is the RECOMPUTED total, and this save passes no line items, so
    // it is 0 rather than the 840 on the fixture row. That is the action doing
    // its job — the figure is derived from the lines, never echoed from the
    // request — so the assertion is that the two differ, not that either is a
    // number the test chose.
    await runReissue();

    const reissue = notifyCalls.find((c) => c.event === "quote_reissued");
    expect(reissue?.previousAmount).toBe(600);
    expect(reissue?.amount).not.toBe(reissue?.previousAmount);
  });
});

describe("the fact the notification is built around", () => {
  it("knows whether the money actually moved", async () => {
    const { totalMoved } = await import("@/lib/reissue-notice");

    expect(totalMoved(600, 840)).toBe(true);
    expect(totalMoved(600, 600)).toBe(false);
  });
});
