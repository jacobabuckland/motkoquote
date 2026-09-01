import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

// A device token belongs to exactly one APNs gateway: an Xcode build gets a
// SANDBOX token, a downloaded build (TestFlight or App Store) a PRODUCTION one.
// Send either to the other's gateway and Apple answers 400 BadDeviceToken.
//
// This used to be one global APNS_ENV, so only one of the two could ever work —
// and because index.ts prunes on `gone`, the losing side did not merely fail to
// deliver, it DELETED the subscription. A contractor on a downloaded build
// enabled notifications, the first send bounced, their row was removed, and
// Settings went back to "No devices registered yet".

const PRODUCTION = "https://api.push.apple.com";
const SANDBOX = "https://api.sandbox.push.apple.com";

// APNs auth is a real ES256 signature over the .p8 key, so the module needs a
// genuine P-256 key or getProviderToken throws before any request is made.
const { privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

type Reply = { status: number; reason?: string };

const payload = {
  title: "Quote accepted",
  body: "Megan Farrant accepted your quote",
  url: "https://motko.app/jobs/job-1",
  event: "quote_accepted" as const,
};

/**
 * Loads a fresh copy of the module with node:http2 stubbed.
 *
 * Fresh per call because the module memoises both the provider JWT and the
 * gateway it resolved for each token; a leaked cache would let one test's
 * discovery satisfy another's assertion.
 *
 * `reply` is asked once per request and sees the host, which is how a test says
 * "production rejects this token, sandbox takes it".
 */
const loadApns = async (
  reply: (host: string, attempt: number) => Reply,
  env: { preferred?: "sandbox" | "production" } = {},
) => {
  vi.resetModules();
  const hosts: string[] = [];

  vi.doMock("node:http2", () => ({
    default: {
      connect: (host: string) => ({
        on: () => {},
        close: () => {},
        request: () => {
          const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
          const attempt = hosts.push(host);
          const req = {
            on(event: string, cb: (arg?: unknown) => void) {
              (handlers[event] ??= []).push(cb);
              return req;
            },
            setEncoding() {},
            end() {
              const { status, reason } = reply(host, attempt);
              queueMicrotask(() => {
                handlers.response?.forEach((cb) => cb({ ":status": status }));
                if (reason) {
                  handlers.data?.forEach((cb) =>
                    cb(JSON.stringify({ reason })),
                  );
                }
                handlers.end?.forEach((cb) => cb());
              });
            },
          };
          return req;
        },
      }),
    },
  }));

  vi.stubEnv("APNS_KEY_ID", "KEY123");
  vi.stubEnv("APNS_TEAM_ID", "TEAM123");
  vi.stubEnv("APNS_PRIVATE_KEY", privateKey.replace(/\n/g, "\\n"));
  vi.stubEnv("APNS_BUNDLE_ID", "app.motko.ios");
  vi.stubEnv("APNS_ENV", env.preferred === "sandbox" ? "sandbox" : "");

  const mod = await import("@/lib/push/apns");
  return { sendApns: mod.sendApns, hosts };
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("choosing the APNs gateway per token", () => {
  it("delivers a downloaded build's token on the first attempt", async () => {
    const { sendApns, hosts } = await loadApns(() => ({ status: 200 }));

    const result = await sendApns("prodtoken0000", payload, "thread-1");

    expect(result.ok).toBe(true);
    expect(result.gone).toBe(false);
    expect(hosts).toEqual([PRODUCTION]);
  });

  it("falls through to sandbox for an Xcode build's token", async () => {
    // The case that was wholly broken: production rejects it as not-its-token,
    // and before this the send simply failed and the device was pruned.
    const { sendApns, hosts } = await loadApns((host) =>
      host === PRODUCTION
        ? { status: 400, reason: "BadDeviceToken" }
        : { status: 200 },
    );

    const result = await sendApns("devtoken00000", payload, "thread-1");

    expect(result.ok).toBe(true);
    expect(result.gone, "a live device must never be pruned").toBe(false);
    expect(hosts).toEqual([PRODUCTION, SANDBOX]);
  });

  it("remembers the gateway, so the second send costs one request", async () => {
    const { sendApns, hosts } = await loadApns((host) =>
      host === PRODUCTION
        ? { status: 400, reason: "BadDeviceToken" }
        : { status: 200 },
    );

    await sendApns("devtoken00000", payload, "thread-1");
    hosts.length = 0;
    await sendApns("devtoken00000", payload, "thread-2");

    expect(hosts).toEqual([SANDBOX]);
  });

  it("prunes only when BOTH gateways reject the token", async () => {
    const { sendApns, hosts } = await loadApns(() => ({
      status: 400,
      reason: "BadDeviceToken",
    }));

    const result = await sendApns("deadtoken0000", payload, "thread-1");

    expect(result.ok).toBe(false);
    expect(result.gone, "rejected everywhere really is gone").toBe(true);
    expect(hosts).toEqual([PRODUCTION, SANDBOX]);
  });

  it("takes a 410 as conclusive without asking the other gateway", async () => {
    // Only the correct gateway can report an uninstall, so Unregistered needs
    // no second opinion — and asking for one would send to a gateway that was
    // never this token's.
    const { sendApns, hosts } = await loadApns(() => ({
      status: 410,
      reason: "Unregistered",
    }));

    const result = await sendApns("goneToken0000", payload, "thread-1");

    expect(result.gone).toBe(true);
    expect(hosts).toEqual([PRODUCTION]);
  });

  it("never prunes on a server error", async () => {
    const { sendApns, hosts } = await loadApns(() => ({
      status: 500,
      reason: "InternalServerError",
    }));

    const result = await sendApns("prodtoken0000", payload, "thread-1");

    expect(result.ok).toBe(false);
    expect(result.gone, "Apple having a bad day is not a dead device").toBe(false);
    expect(hosts).toEqual([PRODUCTION]);
  });

  it("still reaches a production token when APNS_ENV says sandbox", async () => {
    // The exact live misconfiguration. APNS_ENV now only orders the attempts,
    // so a wrong setting costs one extra request instead of every real
    // notification.
    const { sendApns, hosts } = await loadApns(
      (host) =>
        host === SANDBOX
          ? { status: 400, reason: "BadDeviceToken" }
          : { status: 200 },
      { preferred: "sandbox" },
    );

    const result = await sendApns("prodtoken0000", payload, "thread-1");

    expect(result.ok).toBe(true);
    expect(hosts).toEqual([SANDBOX, PRODUCTION]);
  });
});
