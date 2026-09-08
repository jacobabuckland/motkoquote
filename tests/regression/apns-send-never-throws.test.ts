/**
 * Regression guard: a misconfigured APNs credential must not 500 the request.
 *
 * On 8 Sep 2026, with a freshly-deployed APNS_PRIVATE_KEY, "Send test
 * notification" answered "Couldn't send a test notification" — the client's
 * wording for a non-OK HTTP status, not for a rejected device. /api/push/test
 * returns 200 unless something throws, so it had 500'd.
 *
 * The throw came from `createSign().sign()` inside `getProviderToken`, which
 * was called while building the request headers INSIDE the `new Promise`
 * executor in postOnce. Nothing caught it there, so the promise rejected,
 * escaped sendApns — which documents "Never throws" — and propagated through
 * the Promise.all in sendPushToUser and out of the route.
 *
 * The blast radius is the point. That Promise.all fans out to every device a
 * contractor owns, and sendPushToUser is called from the webhooks that fire on
 * contract signature and payment. One unparseable env var therefore took out
 * every push in the app, and the only surface that reported it was a test
 * button.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushPayload } from "@/lib/push/payload";

const DEVICE_TOKEN = "a".repeat(64);

const PAYLOAD: PushPayload = {
  event: "test",
  title: "Motko notifications are on",
  body: "This is a test notification. You're all set.",
  url: "/dashboard",
};

// Everything getConfig() requires, with a private key Node cannot parse. The
// other three are deliberately valid: the failure under test is the key alone,
// not a missing-config short-circuit, which already had its own guard.
const configureWithUnusableKey = () => {
  vi.stubEnv("APNS_KEY_ID", "C6V9T2T3NZ");
  vi.stubEnv("APNS_TEAM_ID", "79Q8PR5SA8");
  vi.stubEnv("APNS_BUNDLE_ID", "app.motko.ios");
  // What a truncated paste into Vercel looks like: the base64 body of a real
  // .p8 with the BEGIN/END armour lost.
  vi.stubEnv("APNS_PRIVATE_KEY", "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIB");
};

// Stands in for the service-role client sendPushToUser fans out with. It
// implements the handful of calls that path makes, not the hundred the type
// declares, so the cast is load-bearing — hence the mocks are returned
// alongside it rather than reached for back through the cast.
const adminStub = (subscriptions: unknown[]) => {
  const pruned: string[] = [];
  const from = vi.fn((table?: string) => {
    if (table === "push_subscriptions") {
      return {
        select: (_columns?: string) => ({
          eq: async (_column?: string, _value?: string) => ({
            data: subscriptions,
          }),
        }),
        delete: () => ({
          in: async (_column?: string, ids?: string[]) => {
            pruned.push(...(ids ?? []));
            return { data: null };
          },
        }),
      };
    }
    return {
      select: (_columns?: string) => ({
        eq: (_column?: string, _value?: string) => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    };
  });
  return { client: { from } as unknown as SupabaseClient, pruned, from };
};

const apnsSubscription = {
  id: "sub-apns-1",
  platform: "apns",
  endpoint: null,
  p256dh: null,
  auth: null,
  device_token: DEVICE_TOKEN,
};

describe("a private key Node cannot parse", () => {
  beforeEach(() => {
    // native module state (the cached provider JWT) must not leak between tests.
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    configureWithUnusableKey();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves as a named failure rather than throwing", async () => {
    const { sendApns } = await import("@/lib/push/apns");

    // The assertion that matters is that this line returns at all. Before the
    // fix it rejected, and every caller inherited that.
    const result = await sendApns(DEVICE_TOKEN, PAYLOAD, "/jobs/job-1");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("InvalidProviderKey");
  });

  it("never reports the device as gone", async () => {
    const { sendApns } = await import("@/lib/push/apns");

    const result = await sendApns(DEVICE_TOKEN, PAYLOAD, "/jobs/job-1");

    // `gone` drives deletion from push_subscriptions. Our credential being
    // broken says nothing about the phone, and pruning a live device over our
    // own misconfiguration is the damage the 1 Sep gateway fix was undoing —
    // re-enabling it here through a different door would be worse than the 500.
    expect(result.gone).toBe(false);
  });

  it("lets the fan-out complete and report the failure per device", async () => {
    const { sendPushToUser } = await import("@/lib/push");
    const { client, pruned } = adminStub([apnsSubscription]);

    const summary = await sendPushToUser(client, "user-1", PAYLOAD);

    expect(summary).toMatchObject({ devices: 1, sent: 0, failed: 1 });
    expect(summary.failures).toEqual([
      { platform: "apns", reason: "InvalidProviderKey" },
    ]);
    expect(pruned).toEqual([]);
  });

  it("does not take down the other devices in the same fan-out", async () => {
    // The real cost of the throw: Promise.all rejects on the first rejection,
    // so one bad APNs credential silenced a contractor's web push too — on a
    // send triggered by a customer signing or paying, not by a test button.
    const { sendPushToUser } = await import("@/lib/push");
    const { client } = adminStub([
      apnsSubscription,
      {
        id: "sub-web-1",
        platform: "webpush",
        endpoint: "https://push.example/endpoint",
        p256dh: "p256dh-key",
        auth: "auth-key",
        device_token: null,
      },
    ]);

    const summary = await sendPushToUser(client, "user-1", PAYLOAD);

    expect(summary.devices).toBe(2);
    // Both are reported on. Whether the web one succeeded depends on VAPID
    // config the test does not stub; what is pinned is that it was ATTEMPTED
    // and accounted for, rather than abandoned by a sibling's rejection.
    expect(summary.sent + summary.failed).toBe(2);
    expect(summary.failures.map((failure) => failure.platform)).toContain("apns");
  });
});
