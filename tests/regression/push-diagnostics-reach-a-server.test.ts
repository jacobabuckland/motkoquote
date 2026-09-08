/**
 * Regression guard: a failed push registration must leave a record off-device,
 * and the toast must not assert a cause it has not established.
 *
 * Both halves come from the same incident, 6–8 Sep 2026.
 *
 * The diagnostics existed. `gatherDiagnostics` had computed isNativePlatform,
 * platform, pluginResolved and permission since 1 Sep — and written them to
 * console.error, which on an App Store build needs a Mac, a cable and
 * Console.app. So nobody read them, and reconstructing ONE occurrence took two
 * days across Xcode archives, the Apple developer portal and App Store Connect.
 * That is the shape AGENTS.md forbids: a signal that must reach a human
 * terminating in telemetry.
 *
 * And the toast said "this build isn't set up for push at Apple's end" —
 * PUSH-NT-PROV. It read as a finding, so the search went to Apple. The App ID
 * had Push enabled, the shipped binary carried `aps-environment: production`
 * (App Store Connect > Build Metadata), no ITMS-90078 existed, and the APNs key
 * authenticated against both gateways. The real cause: the live App Store build
 * was 1.0(1) from 17 July, seven weeks older than the web app it loaded in its
 * WKWebView. A TestFlight install of the 2 Sep build took a token immediately.
 *
 * `classifyNoToken` cannot tell those apart. `pluginResolved` inspects the JS
 * proxy, which is truthy in a plain browser, so `provisioning` is the bucket
 * every native failure lands in — not a diagnosis. Wording it as one aimed two
 * days of work at the wrong company.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mockPluginMethod } from "../helpers/capacitor";
import {
  DIAGNOSTIC_CODE,
  NO_TOKEN_CODE,
  messageForResult,
} from "@/lib/push/native";
import type { NativeRegisterResult } from "@/lib/push/native";

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

const diagnosticsBody = (calls: FetchCall[]): Record<string, unknown> | null => {
  const call = calls.find(([url]) => url === "/api/push/diagnostics");
  if (!call?.[1]?.body) return null;
  return JSON.parse(String(call[1].body)) as Record<string, unknown>;
};

describe("a registration that never gets a token reports itself", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("POSTs the runtime facts to the server", async () => {
    vi.useFakeTimers();
    grantPermission();
    const fetchMock = vi.fn(
      async (_url?: string, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { registerNativePush } = await loadModule();
    const outcome = registerNativePush();
    await vi.advanceTimersByTimeAsync(10_000);

    expect((await outcome).status).toBe("no-token");

    const body = diagnosticsBody(fetchMock.mock.calls as FetchCall[]);
    expect(body, "no diagnostics POST was made").not.toBeNull();
    expect(body).toMatchObject({ status: "no-token", permission: "granted" });
    // The four facts that took two days to establish by hand. Each must be
    // present as its own field — a prose summary cannot be queried.
    for (const field of [
      "is_native_platform",
      "platform",
      "plugin_resolved",
      "permission",
    ]) {
      expect(Object.keys(body ?? {}), `missing ${field}`).toContain(field);
    }
  });

  it("never sends a device token", async () => {
    vi.useFakeTimers();
    grantPermission();
    const fetchMock = vi.fn(
      async (_url?: string, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { registerNativePush } = await loadModule();
    const outcome = registerNativePush();
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;

    const body = diagnosticsBody(fetchMock.mock.calls as FetchCall[]) ?? {};
    // A device token is a credential, and on this path it is also the thing
    // that never arrived. Neither reason permits shipping one here.
    expect(Object.keys(body)).not.toContain("device_token");
    expect(JSON.stringify(body)).not.toMatch(/device_token/i);
  });

  it("does not let a failed diagnostics write change the outcome", async () => {
    vi.useFakeTimers();
    grantPermission();
    // The server is down, or the route 500s. The contractor still gets the
    // toast: the report is evidence, never the signal itself.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url?: string, _init?: RequestInit) => {
        throw new Error("network down");
      }),
    );

    const { registerNativePush } = await loadModule();
    const outcome = registerNativePush();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(outcome).resolves.toMatchObject({ status: "no-token" });
  });
});

describe("the no-token toast stops asserting Apple-side provisioning", () => {
  const provisioning = (): string =>
    messageForResult({
      status: "no-token",
      cause: "provisioning",
    } as NativeRegisterResult) ?? "";

  it("no longer claims the build isn't set up for push at Apple's end", () => {
    // The withdrawn wording, verbatim. It was true of no build we ever shipped.
    expect(provisioning()).not.toMatch(/isn't set up for push/i);
  });

  it("names no Apple-side artefact as the cause", () => {
    const message = provisioning();
    // Each of these was checked during the incident and each was already
    // correct. A toast that points at them sends the reader to Apple, which is
    // exactly the wrong direction when the build is simply old.
    for (const claim of [
      /entitlement/i,
      /provisioning profile/i,
      /App ID/i,
      /certificate/i,
    ]) {
      expect(message, `still blames ${claim}`).not.toMatch(claim);
    }
  });

  it("still reports the observation and the code to quote", () => {
    // Narrowing the claim must not cost the two things that were right: what
    // was actually observed, and something support can look up.
    const message = provisioning();
    expect(message).toMatch(/didn't return a token/i);
    expect(message).toContain(NO_TOKEN_CODE.provisioning);
    expect(NO_TOKEN_CODE.provisioning).toContain(DIAGNOSTIC_CODE.noToken);
  });

  it("offers the newer-build remedy CONDITIONALLY", () => {
    const message = provisioning();
    // A stale install was the real cause on 8 Sep, so the remedy belongs here.
    expect(message).toMatch(/newer version/i);
    // But the FIRST withdrawn version of this string told everyone to upgrade,
    // including people already on the latest build, for whom it was a dead end.
    // The condition is what keeps this true for both readers, so pin it.
    expect(message).toMatch(/\bif\b/i);
    expect(message).toMatch(/otherwise/i);
  });
});
