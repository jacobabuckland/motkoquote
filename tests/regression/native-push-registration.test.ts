/**
 * Regression guard for the iOS "Enable notifications" false success.
 *
 * Settings reported "Notifications enabled on this device" while
 * push_subscriptions stayed empty, so "Send test notification" answered "No
 * devices registered yet" forever. Two independent faults:
 *
 *  1. AppDelegate.swift never forwarded the remote-notification callbacks, so
 *     the APNs token iOS handed back was dropped before it reached JS. The
 *     plugin's register() resolves regardless — it only calls
 *     registerForRemoteNotifications() and resolves (PushNotificationsPlugin
 *     .swift) — so nothing downstream noticed.
 *  2. registerNativePush() returned "registered" off that resolve, before any
 *     token or server save, so the toast could not tell success from silence.
 *
 * Fixing only the second would leave push broken; fixing only the first would
 * leave the next failure silent. Both are pinned here.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mockCapacitorPlugins, mockPluginMethod } from "../helpers/capacitor";

// The code under test branches on this; the Capacitor helper's
// mockNativePlatform only covers the @capacitor/core export, which
// src/lib/platform.ts does not read (it inspects window.Capacitor).
vi.mock("@/lib/platform", () => ({
  isNativeApp: () => true,
  getPlatform: () => "ios",
}));

const readRepoFile = (path: string): string =>
  readFileSync(join(process.cwd(), path), "utf-8");

describe("AppDelegate forwards APNs registration to Capacitor", () => {
  const appDelegate = () => readRepoFile("ios/App/App/AppDelegate.swift");

  it("posts capacitorDidRegisterForRemoteNotifications with the device token", () => {
    const source = appDelegate();

    expect(source).toMatch(
      /didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data/,
    );
    expect(source).toMatch(
      /NotificationCenter\.default\.post\(\s*name: \.capacitorDidRegisterForRemoteNotifications,\s*object: deviceToken\s*\)/,
    );
  });

  it("posts capacitorDidFailToRegisterForRemoteNotifications on failure", () => {
    const source = appDelegate();

    expect(source).toMatch(
      /didFailToRegisterForRemoteNotificationsWithError error: Error/,
    );
    expect(source).toMatch(
      /NotificationCenter\.default\.post\(\s*name: \.capacitorDidFailToRegisterForRemoteNotifications,\s*object: error\s*\)/,
    );
  });

  it("keeps the push entitlement the bridge depends on", () => {
    const entitlements = readRepoFile("ios/App/App/App.entitlements");

    expect(entitlements).toMatch(/<key>aps-environment<\/key>/);
  });
});

describe("registerNativePush reports what actually happened", () => {
  type RegistrationToken = { value: string };

  // Fresh module state per test: native.ts attaches its plugin listeners once
  // per module instance, so without this only the first test sees them.
  const loadModule = async () => {
    vi.resetModules();
    return import("@/lib/push/native");
  };

  const grantPermission = () => {
    mockPluginMethod("PushNotifications", "checkPermissions", () => ({
      receive: "granted",
    }));
  };

  // How many times native.ts tried to attach the "registration" listener. One
  // per attach attempt, successful or not — which is what distinguishes a retry
  // from a short-circuit.
  const registrationAttaches = (): number =>
    mockCapacitorPlugins()
      .PushNotifications.getCalls()
      .filter(
        (record) => record.method === "addListener" && record.args[0] === "registration",
      ).length;

  // register() is called only after registerNativePush has installed the pending
  // settle, so waiting on it is how a test knows the token it fires will land.
  const registerCalls = (): number =>
    mockCapacitorPlugins()
      .PushNotifications.getCalls()
      .filter((record) => record.method === "register").length;

  // The most recently attached callback for an event, so a test that provoked a
  // failed attach reads the retry's listener rather than the dead one.
  const latestListenerFor = <T>(event: string): ((payload: T) => void) => {
    const calls = mockCapacitorPlugins()
      .PushNotifications.getCalls()
      .filter(
        (record) => record.method === "addListener" && record.args[0] === event,
      );
    const call = calls[calls.length - 1];
    if (!call) throw new Error(`no listener registered for "${event}"`);
    return call.args[1] as (payload: T) => void;
  };

  // The callback native.ts handed to PushNotifications.addListener(event, …).
  const listenerFor = <T>(event: string): ((payload: T) => void) => {
    const call = mockCapacitorPlugins()
      .PushNotifications.getCalls()
      .find((record) => record.method === "addListener" && record.args[0] === event);
    if (!call) throw new Error(`no listener registered for "${event}"`);
    return call.args[1] as (payload: T) => void;
  };

  it("resolves 'registered' only after the token reaches the server", async () => {
    grantPermission();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { registerNativePush } = await loadModule();
    const outcome = registerNativePush();
    // Let permission checks and register() settle without resolving `outcome`.
    await vi.waitFor(() => listenerFor("registration"));
    expect(fetchMock).not.toHaveBeenCalled();

    listenerFor<RegistrationToken>("registration")({ value: "device-token-1" });

    expect(await outcome).toEqual({ status: "registered" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/push/subscribe",
      expect.objectContaining({ method: "POST" }),
    );
    vi.unstubAllGlobals();
  });

  it("resolves 'save-failed' when the subscribe POST is rejected", async () => {
    grantPermission();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    const { registerNativePush } = await loadModule();
    const outcome = registerNativePush();
    await vi.waitFor(() => listenerFor("registration"));

    listenerFor<RegistrationToken>("registration")({ value: "device-token-2" });

    expect(await outcome).toEqual({ status: "save-failed" });
    vi.unstubAllGlobals();
  });

  it("resolves 'no-token' when APNs never answers", async () => {
    vi.useFakeTimers();
    grantPermission();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { registerNativePush } = await loadModule();
    const outcome = registerNativePush();
    // This is the shipped bug: the plugin resolves register() and no token
    // ever follows, so nothing but the timeout can settle the call.
    await vi.advanceTimersByTimeAsync(10_000);

    // The result now carries WHY, so the toast can name it instead of showing
    // one string for three unrelated faults. The cause here is whatever this
    // harness's runtime probe reports; what this test pins is that a cause is
    // always present, because the UI copy branches on it.
    const result = await outcome;
    expect(result.status).toBe("no-token");
    expect(
      result.status === "no-token" ? result.cause : undefined,
      "a no-token result must always name its cause",
    ).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves 'error' when APNs reports a registration error", async () => {
    grantPermission();
    const { registerNativePush } = await loadModule();
    const outcome = registerNativePush();
    await vi.waitFor(() => listenerFor("registrationError"));

    listenerFor<{ error: string }>("registrationError")({ error: "no entitlement" });

    expect(await outcome).toEqual({ status: "error" });
  });

  it("retries the listener attach after a failed one, instead of looking attached", async () => {
    // The shipped defect: handlersAttached was set before the addListener
    // calls, so one failure left the module permanently "attached" — the token
    // then arrived with nothing listening and every later attempt said no-token.
    grantPermission();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    let attachAttempts = 0;
    mockPluginMethod("PushNotifications", "addListener", () => {
      attachAttempts += 1;
      if (attachAttempts === 1) return Promise.reject(new Error("plugin not ready"));
      return { remove: () => Promise.resolve() };
    });

    const { registerNativePush } = await loadModule();

    expect(await registerNativePush()).toEqual({ status: "error" });
    expect(registrationAttaches()).toBe(1);

    // Second attempt must attach again rather than short-circuit.
    const outcome = registerNativePush();
    await vi.waitFor(() => expect(registrationAttaches()).toBe(2));

    latestListenerFor<RegistrationToken>("registration")({ value: "token-after-retry" });

    expect(await outcome).toEqual({ status: "registered" });
    vi.unstubAllGlobals();
  });

  it("reuses the launch-time attach instead of adding a second listener", async () => {
    // The order the app actually runs: NativeAppInit attaches at mount, the
    // Settings button registers later. The second call must reuse that attach —
    // a duplicate listener would double every token POST that follows.
    grantPermission();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    const { initNativePush, registerNativePush } = await loadModule();
    await initNativePush(() => {});
    expect(registrationAttaches()).toBe(1);

    const outcome = registerNativePush();
    // The listener is already attached, so wait on register() rather than on
    // the attach — otherwise the token fires before the settle is installed.
    await vi.waitFor(() => expect(registerCalls()).toBe(1));
    expect(registrationAttaches()).toBe(1);

    latestListenerFor<RegistrationToken>("registration")({ value: "token-shared" });

    expect(await outcome).toEqual({ status: "registered" });
    expect(registrationAttaches()).toBe(1);
    vi.unstubAllGlobals();
  });

  it("resolves 'denied' without waiting when permission is refused", async () => {
    mockPluginMethod("PushNotifications", "checkPermissions", () => ({
      receive: "denied",
    }));

    const { registerNativePush } = await loadModule();

    expect(await registerNativePush()).toEqual({ status: "denied" });
  });
});
