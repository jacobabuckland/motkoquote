/**
 * @vitest-environment happy-dom
 */

/**
 * A Capacitor plugin missing from the native binary must not take down the
 * Settings page.
 *
 * `ios/App/Podfile` declared seven pods while `package.json` declares thirteen,
 * so six plugins were compiled out of the shipped app — `@capacitor/browser`
 * among them. On device, every call into one of those throws "Browser plugin is
 * not implemented on ios".
 *
 * `Browser.open` was already guarded, and degrades to `window.location.href`, so
 * Stripe onboarding survives. The unguarded call is 45 lines earlier and fires
 * on MOUNT rather than on any press:
 *
 *     const listener = Browser.addListener("browserFinished", handleBrowserFinished);
 *
 * inside a `useEffect` gated on `isNativePlatform()`. So the section threw as
 * soon as a native user opened Settings — nothing to do with pressing anything,
 * and the guarded `Browser.open` below it never got the chance to degrade.
 *
 * The Podfile is fixed alongside this, but a rebuild only reaches users who
 * update. This holds for everyone already on a shipped binary, and for whatever
 * plugin is missing next: attaching a listener is an optimisation — it refreshes
 * Stripe status when the in-app browser closes — and losing it costs a manual
 * refresh, not a working page.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { mockCapacitorPlugins, mockNativePlatform, mockPluginMethod } from "../helpers/capacitor";

vi.mock("@/app/settings/stripe-connect-actions", () => ({
  startStripeOnboarding: vi.fn(async () => ({ url: "https://connect.stripe.test/onboard" })),
  refreshStripeStatus: vi.fn(async () => ({ ok: true })),
  fetchStripeRequirements: vi.fn(async () => ({ requirements: [] })),
}));

afterEach(cleanup);

const NOT_IMPLEMENTED = '"Browser" plugin is not implemented on ios';

const renderSection = async () => {
  const { StripeConnectSection } = await import("@/app/settings/stripe-connect-section");
  render(
    <StripeConnectSection
      stripeAccountId={null}
      stripePayoutsEnabled={false}
      stripePayByBankEnabled={false}
      stripeRequirementsDue={false}
    />,
  );
};

describe("Settings on a native build missing the Browser plugin", () => {
  it("renders rather than throwing on mount", async () => {
    mockNativePlatform(true);
    mockCapacitorPlugins();
    mockPluginMethod("Browser", "addListener", () => {
      throw new Error(NOT_IMPLEMENTED);
    });

    await renderSection();

    // Something rendered. Before the guard this threw out of the effect and
    // took the whole section with it.
    expect(document.body.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("still offers the contractor a way to start onboarding", async () => {
    // The point of the page surviving: getting paid is reachable. Browser.open
    // is separately guarded and degrades to window.location, so the flow works
    // without the plugin — but only if the section renders at all.
    mockNativePlatform(true);
    mockCapacitorPlugins();
    mockPluginMethod("Browser", "addListener", () => {
      throw new Error(NOT_IMPLEMENTED);
    });

    await renderSection();

    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("unmounts cleanly when the listener was never attached", async () => {
    // The cleanup path used to call .then() on the listener promise
    // unconditionally. With no listener there is nothing to remove, and
    // reaching for one is a second throw on the way out.
    mockNativePlatform(true);
    mockCapacitorPlugins();
    mockPluginMethod("Browser", "addListener", () => {
      throw new Error(NOT_IMPLEMENTED);
    });

    await renderSection();

    expect(() => cleanup()).not.toThrow();
  });
});

describe("Settings on a build that has the plugin", () => {
  it("still attaches the browserFinished listener", async () => {
    // The guard must not have quietly removed the behaviour it protects. This
    // is the half that would otherwise rot unnoticed.
    mockNativePlatform(true);
    const mocks = mockCapacitorPlugins();

    await renderSection();

    const attached = mocks.Browser.getCalls().filter((call) => call.method === "addListener");
    expect(attached).toHaveLength(1);
    expect(attached[0].args[0]).toBe("browserFinished");
  });

  it("attaches nothing on the web, where there is no in-app browser to close", async () => {
    mockNativePlatform(false);
    const mocks = mockCapacitorPlugins();

    await renderSection();

    expect(mocks.Browser.getCalls().filter((c) => c.method === "addListener")).toHaveLength(0);
  });
});
