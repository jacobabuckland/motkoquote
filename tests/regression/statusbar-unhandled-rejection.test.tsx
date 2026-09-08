/**
 * @vitest-environment happy-dom
 */

// The status-bar init on the native shell.
//
// `@capacitor/status-bar` is a dependency in package.json, but CapacitorStatusBar
// is NOT in ios/App/Podfile or Podfile.lock — the native side was never synced.
// So on a real device `StatusBar.setStyle()` rejects with
//
//     Error: "StatusBar" plugin is not implemented on ios
//
// and it was the one native call in NativeAppInit's mount effect without a
// catch. Sentry recorded 23 unhandled rejections over 26 hours
// (JAVASCRIPT-NEXTJS-1), every one a dashboard load inside the shell.
//
// WHAT IS NOT ASSERTED HERE, AND WHY. The property the fix restores — that the
// rejection is swallowed rather than escaping — cannot be observed through the
// shared Capacitor helper, so there is deliberately no test for it. Measured
// rather than assumed, in this order:
//
//   1. Listening for the DOM "unhandledrejection" event sees nothing: under
//      vitest + happy-dom, rejections surface as Node's process
//      "unhandledRejection" (probed: window 0, process 1).
//   2. Listening on process ALSO sees nothing for a plugin call, because
//      tests/helpers/capacitor.ts builds every plugin method with `vi.fn`, and
//      the spy attaches its own handler to the returned promise to record the
//      result. That marks the rejection HANDLED before Node can report it —
//      confirmed directly: the mocked setStyle rejects (a .then rejection
//      handler fires) while the process listener records zero.
//
// So an assertion written that way passes identically with `.catch()` and with
// `void`, which is a test that cannot fail — worse than none. A bespoke
// `vi.mock` for the plugin would dodge the spy, but AGENTS.md forbids one in an
// individual test file, and that rule is right: it is what keeps these mocks
// consistent.
//
// What IS pinned below is the pair either half of a bad "fix" would break:
// the call must still be MADE on native (so nobody satisfies "handle the
// rejection" by deleting the call), and must NOT be made on web.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { mockNativePlatform, mockCapacitorPlugins, mockPluginMethod } from "../helpers/capacitor";
import { NativeAppInit } from "@/components/native-app-init";

// Imported statically, and vi.resetModules() deliberately NOT used: with a
// dynamic import the FIRST one in the file does not pick up the hoisted
// @capacitor/core mock, so whichever case ran first saw a web platform and
// recorded no calls. The bug looked like a component fault and was a
// module-registry artefact of the test.
afterEach(cleanup);

/** Drain microtasks and timers so the mount effect's async work has run. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("NativeAppInit and the status bar", () => {
  it("asks for the light style on a native platform", async () => {
    // White text on the brand green is the point of the call, so "handle the
    // rejection" must never be satisfied by dropping it. A `npx cap sync` that
    // installs the pod makes it succeed and the catch then costs nothing.
    mockNativePlatform(true);
    const mocks = mockCapacitorPlugins();

    render(<NativeAppInit />);
    await settle();

    const setStyleCalls = mocks.StatusBar.getCalls().filter((c) => c.method === "setStyle");
    expect(setStyleCalls.length).toBeGreaterThan(0);
    expect(setStyleCalls[0].args[0]).toEqual({ style: "LIGHT" });
  });

  it("does not touch the status bar on the web", async () => {
    mockNativePlatform(false);
    const mocks = mockCapacitorPlugins();

    render(<NativeAppInit />);
    await settle();

    expect(mocks.StatusBar.getCalls()).toEqual([]);
  });

  it("keeps mounting, and keeps initialising, when the plugin is missing", async () => {
    // Weaker than "the rejection is contained" — see the header — but real: a
    // rejecting status bar must not stop the rest of the mount effect, which is
    // what actually matters to a device with no StatusBar pod installed.
    mockNativePlatform(true);
    const mocks = mockCapacitorPlugins();
    mockPluginMethod("StatusBar", "setStyle", () =>
      Promise.reject(new Error('"StatusBar" plugin is not implemented on ios')),
    );

    const { container } = render(<NativeAppInit />);
    await settle();

    expect(container).toBeDefined();
    expect(
      mocks.StatusBar.getCalls().some((c) => c.method === "setStyle"),
      "the call must still be attempted even when the plugin is absent",
    ).toBe(true);
  });
});
