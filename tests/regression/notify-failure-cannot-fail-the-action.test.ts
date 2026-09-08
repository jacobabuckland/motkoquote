/**
 * A notification that fails must never fail the action that triggered it.
 *
 * This is the regression guard for the 8 Sep 2026 cluster. A malformed
 * APNS_PRIVATE_KEY made `createSign().sign()` throw from inside the promise
 * executor in `postOnce`. Nothing caught it, so it escaped `sendApns` — which
 * documents "never throws" — propagated through the `Promise.all` fan-out in
 * `sendPushToUser`, and came out of FIVE server flows as a failed action:
 *
 *   GET  /q/[id]      the customer's first view of a quote
 *   POST /q/[id]      accept
 *   POST /c/[id]      sign the contract
 *   POST /dashboard   mark as paid
 *   plus every push send
 *
 * Every one of those had already committed its database write. So the customer
 * was told the action failed when it had succeeded, and the retry appeared to
 * work only because a state guard skipped the notification the second time.
 * Four separate defects were reported before anyone noticed they were one bug.
 *
 * Two things are asserted here, and the second is the one that stops the fix
 * from becoming a different defect:
 *
 *   1. A throwing channel cannot propagate out of the notifier.
 *   2. The failure is RECORDED. Wrapping alone turns a loud failure into a
 *      silent one, and a trade who never learns their quote was accepted has a
 *      business failure, not a logging gap.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const trackCalls: { event: string; properties: Record<string, unknown> }[] = [];

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(async (event?: string, properties?: Record<string, unknown>) => {
    trackCalls.push({ event: event ?? "", properties: properties ?? {} });
  }),
  logError: vi.fn(async () => {}),
}));

// The email side. Each test decides whether it throws, and the throwing case is
// the one that was live in production.
const emailBehaviour = { mode: "delivers" as "delivers" | "throws" | "undelivered" };

vi.mock("@/lib/email", () => ({
  sendContractorNotificationEmail: vi.fn(async () => {
    if (emailBehaviour.mode === "throws") throw new Error("getaddrinfo ENOTFOUND api.resend.com");
    return { delivered: emailBehaviour.mode === "delivers" };
  }),
}));

const pushBehaviour = { mode: "delivers" as "delivers" | "throws" | "no_devices" };

vi.mock("@/lib/push", () => ({
  sendPushToUser: vi.fn(async () => {
    if (pushBehaviour.mode === "throws") {
      throw new Error("error:1E08010C:DECODER routines::unsupported");
    }
    if (pushBehaviour.mode === "no_devices") {
      return { devices: 0, sent: 0, failed: 0, pruned: 0, failures: [] };
    }
    return { devices: 1, sent: 1, failed: 0, pruned: 0, failures: [] };
  }),
}));

// Returns a contractor with both an email address and an owner user, so both
// channels are actually attempted rather than skipped for want of a target.
const adminStub = (): SupabaseClient => {
  const from = (_table?: string) => ({
    select: (_columns?: string) => ({
      eq: (_column?: string, _value?: string) => ({
        maybeSingle: async () => ({
          data: {
            contractor: {
              owner_user_id: "user-1",
              business_profile: { business_email: "trade@example.com" },
            },
          },
        }),
      }),
    }),
  });
  return { from } as unknown as SupabaseClient;
};

const input = {
  jobId: "job-1",
  event: "quote_accepted" as const,
  subject: "Dave accepted your quote",
  heading: "Dave accepted your quote.",
  nextStep: "Next step: send them a contract to sign.",
};

const deliveryRecord = () =>
  trackCalls.find((call) => call.event === "notification_delivery");

describe("a failing notification cannot fail the action", () => {
  beforeEach(() => {
    trackCalls.length = 0;
    emailBehaviour.mode = "delivers";
    pushBehaviour.mode = "delivers";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not propagate a throwing push", async () => {
    pushBehaviour.mode = "throws";
    const { notifyContractorOfCustomerAction } = await import("@/lib/notify-contractor");

    // The assertion that matters is that this RESOLVES. Before the fix it
    // rejected, and every caller inherited the rejection as a failed action.
    await expect(
      notifyContractorOfCustomerAction(adminStub(), input),
    ).resolves.toMatchObject({ push: "failed" });
  });

  it("does not propagate a throwing email", async () => {
    // The leg PR #678 does not close: Resend raising on a transport failure.
    emailBehaviour.mode = "throws";
    const { notifyContractorOfCustomerAction } = await import("@/lib/notify-contractor");

    await expect(
      notifyContractorOfCustomerAction(adminStub(), input),
    ).resolves.toMatchObject({ email: "failed" });
  });

  it("still delivers the other channel when one throws", async () => {
    // A broken credential on one transport must not silence the one that works.
    pushBehaviour.mode = "throws";
    emailBehaviour.mode = "delivers";
    const { notifyContractorOfCustomerAction } = await import("@/lib/notify-contractor");

    const outcome = await notifyContractorOfCustomerAction(adminStub(), input);

    expect(outcome).toEqual({ email: "delivered", push: "failed" });
  });

  it("records the failure rather than swallowing it", async () => {
    pushBehaviour.mode = "throws";
    const { notifyContractorOfCustomerAction } = await import("@/lib/notify-contractor");

    await notifyContractorOfCustomerAction(adminStub(), input);

    const record = deliveryRecord();
    expect(record, "no delivery record was written").toBeDefined();
    // `failed` is the single field the daily signal counts, so it has to be
    // true whenever either channel failed — not merely inferable from the pair.
    expect(record?.properties.failed).toBe(true);
    expect(record?.properties.push).toBe("failed");
    expect(record?.properties.job_id).toBe("job-1");
  });

  it("records a success too, so the count has a denominator", async () => {
    const { notifyContractorOfCustomerAction } = await import("@/lib/notify-contractor");

    await notifyContractorOfCustomerAction(adminStub(), input);

    expect(deliveryRecord()?.properties.failed).toBe(false);
  });

  it("never records an email address or a device token", async () => {
    emailBehaviour.mode = "throws";
    const { notifyContractorOfCustomerAction } = await import("@/lib/notify-contractor");

    await notifyContractorOfCustomerAction(adminStub(), input);

    // The record exists to answer "was this trade told?", which the job id
    // already answers. An address in an analytics table is PII nobody asked for.
    const serialised = JSON.stringify(deliveryRecord()?.properties ?? {});
    expect(serialised).not.toContain("trade@example.com");
    expect(serialised).not.toMatch(/device_token/i);
  });

  it("survives a lookup that throws, without inventing a delivery", async () => {
    // The contractor lookup is a network call on the same path. A failure to
    // find out WHO to notify must not become a failed settlement either — and
    // it must not be recorded as a success.
    const throwingAdmin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              throw new Error("connection terminated unexpectedly");
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const { notifyContractorOfCustomerAction } = await import("@/lib/notify-contractor");

    await expect(
      notifyContractorOfCustomerAction(throwingAdmin, input),
    ).resolves.toEqual({ email: "failed", push: "failed" });
    expect(deliveryRecord()?.properties.failed).toBe(true);
  });

  it("distinguishes 'no devices registered' from 'delivery failed'", async () => {
    // A trade who never enabled notifications has not suffered a failure, and
    // counting them as one would make the daily signal cry wolf every day.
    pushBehaviour.mode = "no_devices";
    const { notifyContractorOfCustomerAction } = await import("@/lib/notify-contractor");

    const outcome = await notifyContractorOfCustomerAction(adminStub(), input);

    expect(outcome.push).toBe("no_devices");
    expect(deliveryRecord()?.properties.failed).toBe(false);
  });
});
