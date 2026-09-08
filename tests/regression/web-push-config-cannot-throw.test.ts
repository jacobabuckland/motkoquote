/**
 * A malformed VAPID key must degrade to "this device didn't get it", never to
 * "your quote wasn't accepted".
 *
 * This is the leg PR #678 does not close. That PR fixed the APNs transport,
 * where an unparseable APNS_PRIVATE_KEY threw from inside a promise executor
 * and escaped the fan-out. The web-push transport had the same shape for the
 * same reason: `sendWebPush` had a real try/catch, but `ensureConfigured()` —
 * which calls `webpush.setVapidDetails`, and which VALIDATES the key pair and
 * throws on a bad one — was called on the line ABOVE it.
 *
 * So the identical outage was reachable through a different credential, and the
 * fix for one would not have found the other. Both are now inside the guard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadModule = async () => {
  // The module memoises its configured state, so each test needs a fresh copy.
  vi.resetModules();
  return import("@/lib/push/web");
};

const TARGET = {
  endpoint: "https://push.example/endpoint",
  p256dh: "p256dh-key",
  auth: "auth-key",
};

const PAYLOAD = {
  event: "quote_accepted" as const,
  title: "Dave accepted your quote",
  body: "Next step: send them a contract to sign.",
  url: "/jobs/job-1",
};

describe("web push with an unusable VAPID configuration", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves rather than throwing when the keys are malformed", async () => {
    // web-push rejects a public key that is not 65 bytes of uncompressed P-256,
    // and it does so by throwing out of setVapidDetails.
    vi.stubEnv("VAPID_PUBLIC_KEY", "not-a-real-vapid-public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "not-a-real-vapid-private-key");
    const { sendWebPush } = await loadModule();

    // Resolving at all is the claim. Before the fix this threw, and the throw
    // travelled all the way out of whichever server action was running.
    const result = await sendWebPush(TARGET, PAYLOAD);

    expect(result.ok).toBe(false);
  });

  it("never reports the device as gone over our own misconfiguration", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "not-a-real-vapid-public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "not-a-real-vapid-private-key");
    const { sendWebPush } = await loadModule();

    const result = await sendWebPush(TARGET, PAYLOAD);

    // `gone` drives deletion from push_subscriptions. Our keys being wrong says
    // nothing about the browser, and pruning a live subscription over it would
    // re-open the deletion bug the 1 Sep gateway fix closed — through a
    // different door.
    expect(result.gone).toBe(false);
  });

  it("resolves when no VAPID keys are configured at all", async () => {
    // Every dev machine. This path was already safe; it is pinned so the fix
    // above cannot regress it while moving the guard.
    const { sendWebPush } = await loadModule();

    const result = await sendWebPush(TARGET, PAYLOAD);

    expect(result).toMatchObject({ ok: false, gone: false });
  });
});
