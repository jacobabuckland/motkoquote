/**
 * Regression guard: a registering device records which NATIVE build it is.
 *
 * Motko ships as a WKWebView pointed at motko.app, so the JS half updates on
 * every Vercel deploy while the native shell is frozen at whatever build last
 * cleared App Store review. Nothing recorded which build that was — `ios/` in
 * this repo describes a binary that may be on nobody's phone.
 *
 * That gap is what made the Sept 2026 push outage take a week. Push had been
 * broken for every App Store user since 21 Aug because 1.01 was released to
 * TestFlight and never submitted for review; the symptom on a contractor's
 * phone was indistinguishable from an Apple-side misconfiguration, and
 * establishing which build was actually live required Xcode archives, the
 * developer portal and App Store Connect.
 *
 * With the build on the subscription row it is one query:
 *   select user_agent, count(*) from push_subscriptions
 *   where platform = 'apns' group by 1;
 *
 * What is pinned here is that the shell's OWN version and build travel with the
 * token — not the web bundle's, which is always current and therefore never the
 * thing in question.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
// Both helpers are imported STATICALLY. Reaching for them with a dynamic
// import after vi.resetModules() hands back a fresh helper instance whose call
// log is empty and whose plugin mocks are different objects, so every
// assertion silently addresses a different set of mocks than the code under
// test used.
import { mockCapacitorPlugins, mockPluginMethod } from "../helpers/capacitor";
import { apnsSubscriptionInputSchema } from "@/lib/schemas/notification";

// native.ts branches on this; the Capacitor helper only covers the
// @capacitor/core export, which src/lib/platform.ts does not read.
vi.mock("@/lib/platform", () => ({
  isNativeApp: () => true,
  getPlatform: () => "ios",
}));

type FetchCall = [string?, RequestInit?];

const loadModule = async () => {
  vi.resetModules();
  return import("@/lib/push/native");
};

const grantPermission = () => {
  mockPluginMethod("PushNotifications", "checkPermissions", () => ({
    receive: "granted",
  }));
};

const subscribeBody = (calls: FetchCall[]): Record<string, unknown> | null => {
  const call = calls.find(([url]) => url === "/api/push/subscribe");
  if (!call?.[1]?.body) return null;
  return JSON.parse(String(call[1].body)) as Record<string, unknown>;
};

// The callback native.ts handed to PushNotifications.addListener(event, …).
const listenerFor = (event: string): ((payload: { value: string }) => void) => {
  const call = mockCapacitorPlugins()
    .PushNotifications.getCalls()
    .find(
      (record) => record.method === "addListener" && record.args[0] === event,
    );
  if (!call) throw new Error(`no listener registered for "${event}"`);
  return call.args[1] as (payload: { value: string }) => void;
};

// Drives a full successful registration and returns what was POSTed.
const registerAndCaptureBody = async (): Promise<Record<
  string,
  unknown
> | null> => {
  grantPermission();
  const fetchMock = vi.fn(
    async (_url?: string, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const { registerNativePush } = await loadModule();
  const outcome = registerNativePush();

  await vi.waitFor(() => listenerFor("registration"));
  listenerFor("registration")({ value: "d".repeat(64) });
  await outcome;

  return subscribeBody(fetchMock.mock.calls as FetchCall[]);
};

describe("the subscribe payload carries the native shell's build", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the version and build the shell reports", async () => {
    mockPluginMethod("App", "getInfo", () => ({
      name: "Motko",
      id: "app.motko.ios",
      version: "1.01",
      build: "6",
    }));

    const body = await registerAndCaptureBody();

    expect(body, "no subscribe POST was made").not.toBeNull();
    expect(body).toMatchObject({
      platform: "apns",
      app_version: "1.01",
      app_build: "6",
    });
  });

  it("still registers when the shell cannot report its build", async () => {
    // getInfo is unimplemented on the web and can be absent from a shell that
    // predates this change — which is exactly the stale-build case this exists
    // to detect, so it must not be the thing that blocks registration. The
    // token is what makes a device reachable; the build number is context.
    mockPluginMethod("App", "getInfo", () => undefined);

    const body = await registerAndCaptureBody();

    expect(body).toMatchObject({ platform: "apns" });
    expect(body?.device_token).toBeTruthy();
    expect(Object.keys(body ?? {})).not.toContain("app_version");
  });
});

describe("the schema accepts the shell fields without requiring them", () => {
  it("accepts a payload carrying the build", () => {
    const parsed = apnsSubscriptionInputSchema.safeParse({
      platform: "apns",
      device_token: "a".repeat(64),
      app_version: "1.01",
      app_build: "6",
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts a payload from a shell that predates this change", () => {
    // Every device already registered posts this shape. A required field here
    // would 400 them on their next re-registration, which is a worse outcome
    // than not knowing their build.
    const parsed = apnsSubscriptionInputSchema.safeParse({
      platform: "apns",
      device_token: "a".repeat(64),
    });
    expect(parsed.success).toBe(true);
  });
});
