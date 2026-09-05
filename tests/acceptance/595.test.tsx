/**
 * @vitest-environment happy-dom
 *
 * Acceptance tests for Issue #595: CONN-2 — Onboarding opens in SFSafariViewController
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  mockNativePlatform,
  mockCapacitorPlugins,
  resetCapacitorCalls,
} from "../helpers/capacitor";

afterEach(cleanup);

describe("Issue #595: Stripe Connect onboarding in native iOS shell", () => {
  describe("Dependencies", () => {
    it("has @capacitor/browser in package.json dependencies", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const packageJson = JSON.parse(
        readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };

      expect(packageJson.dependencies).toHaveProperty("@capacitor/browser");
    });

    it("capacitor helper mocks Browser plugin", () => {
      const mocks = mockCapacitorPlugins();

      expect(mocks.Browser).toBeDefined();
      expect(mocks.Browser.getCalls).toBeDefined();
      expect(typeof mocks.Browser.getCalls).toBe("function");
    });
  });

  describe("StripeConnectSection component", () => {
    it("can be imported", async () => {
      const mod = await import("@/app/settings/stripe-connect-section");
      expect(mod.StripeConnectSection).toBeDefined();
      expect(typeof mod.StripeConnectSection).toBe("function");
    });
  });

  describe("Native platform path", () => {
    it("calls Browser.open with account-link URL, never assigns window.location", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      // Mock the server action to return a URL
      const mockStartOnboarding = vi.fn(async () => ({
        url: "https://connect.stripe.com/setup/test-link",
      }));

      // Spy on window.location assignments
      const locationSpy = vi.spyOn(window.location, "href", "set");

      vi.resetModules();
      vi.doMock("@/app/settings/stripe-connect-actions", () => ({
        startStripeOnboarding: mockStartOnboarding,
        refreshStripeStatus: vi.fn(async () => ({ success: true })),
      }));

      const { StripeConnectSection } = await import(
        "@/app/settings/stripe-connect-section"
      );

      render(
        <StripeConnectSection
          stripeAccountId={null}
          stripePayoutsEnabled={false}
          stripeRequirementsDue={false}
        />,
      );

      const button = screen.getByRole("button", { name: /Connect to Stripe/i });
      button.click();

      await waitFor(() => {
        const browserCalls = mocks.Browser.getCalls();
        expect(browserCalls.length).toBeGreaterThan(0);
      });

      const browserCalls = mocks.Browser.getCalls();
      const openCall = browserCalls.find((call) => call.method === "open");

      expect(openCall).toBeDefined();
      expect(openCall?.args[0]).toMatchObject({
        url: "https://connect.stripe.com/setup/test-link",
      });

      // window.location.href must NOT be assigned on native
      expect(locationSpy).not.toHaveBeenCalled();

      locationSpy.mockRestore();
    });

    it("listens for browserFinished event and calls refreshStripeStatus", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      const mockRefreshStatus = vi.fn(async () => ({ success: true }));

      vi.resetModules();
      vi.doMock("@/app/settings/stripe-connect-actions", () => ({
        startStripeOnboarding: vi.fn(async () => ({
          url: "https://connect.stripe.com/setup/test",
        })),
        refreshStripeStatus: mockRefreshStatus,
      }));

      const { StripeConnectSection } = await import(
        "@/app/settings/stripe-connect-section"
      );

      render(
        <StripeConnectSection
          stripeAccountId="acct_test"
          stripePayoutsEnabled={false}
          stripeRequirementsDue={true}
        />,
      );

      const button = screen.getByRole("button", {
        name: /Complete requirements/i,
      });
      button.click();

      // Wait for Browser.open to be called
      await waitFor(() => {
        const browserCalls = mocks.Browser.getCalls();
        expect(browserCalls.length).toBeGreaterThan(0);
      });

      // Verify addListener was called for browserFinished
      const listenerCalls = mocks.Browser.getCalls().filter(
        (call) => call.method === "addListener",
      );

      expect(listenerCalls.length).toBeGreaterThan(0);

      const browserFinishedListener = listenerCalls.find(
        (call) => call.args[0] === "browserFinished",
      );

      expect(browserFinishedListener).toBeDefined();
      expect(typeof browserFinishedListener?.args[1]).toBe("function");
    });

    it("surfaces error when startStripeOnboarding fails", async () => {
      mockNativePlatform(true);
      mockCapacitorPlugins();

      vi.resetModules();
      vi.doMock("@/app/settings/stripe-connect-actions", () => ({
        startStripeOnboarding: vi.fn(async () => ({
          error: "Stripe account creation failed",
        })),
        refreshStripeStatus: vi.fn(async () => ({ success: true })),
      }));

      const { StripeConnectSection } = await import(
        "@/app/settings/stripe-connect-section"
      );

      render(
        <StripeConnectSection
          stripeAccountId={null}
          stripePayoutsEnabled={false}
          stripeRequirementsDue={false}
        />,
      );

      const button = screen.getByRole("button", { name: /Connect to Stripe/i });
      button.click();

      await waitFor(() => {
        expect(
          screen.getByText(/Stripe account creation failed/i),
        ).toBeDefined();
      });
    });
  });

  describe("Web platform path", () => {
    it("assigns window.location.href, never calls Browser.open", async () => {
      mockNativePlatform(false);
      const mocks = mockCapacitorPlugins();

      vi.resetModules();
      vi.doMock("@/app/settings/stripe-connect-actions", () => ({
        startStripeOnboarding: vi.fn(async () => ({
          url: "https://connect.stripe.com/setup/web-test",
        })),
        refreshStripeStatus: vi.fn(async () => ({ success: true })),
      }));

      const { StripeConnectSection } = await import(
        "@/app/settings/stripe-connect-section"
      );

      // Spy on window.location.href assignments
      const locationSpy = vi.spyOn(window.location, "href", "set");

      render(
        <StripeConnectSection
          stripeAccountId={null}
          stripePayoutsEnabled={false}
          stripeRequirementsDue={false}
        />,
      );

      const button = screen.getByRole("button", { name: /Connect to Stripe/i });
      button.click();

      await waitFor(() => {
        expect(locationSpy).toHaveBeenCalledWith(
          "https://connect.stripe.com/setup/web-test",
        );
      });

      // Browser.open must NOT be called on web
      const browserCalls = mocks.Browser.getCalls();
      const openCalls = browserCalls.filter((call) => call.method === "open");
      expect(openCalls).toHaveLength(0);

      locationSpy.mockRestore();
    });

    it("surfaces error when startStripeOnboarding fails", async () => {
      mockNativePlatform(false);
      mockCapacitorPlugins();

      vi.resetModules();
      vi.doMock("@/app/settings/stripe-connect-actions", () => ({
        startStripeOnboarding: vi.fn(async () => ({
          error: "Not authenticated",
        })),
        refreshStripeStatus: vi.fn(async () => ({ success: true })),
      }));

      const { StripeConnectSection } = await import(
        "@/app/settings/stripe-connect-section"
      );

      render(
        <StripeConnectSection
          stripeAccountId={null}
          stripePayoutsEnabled={false}
          stripeRequirementsDue={false}
        />,
      );

      const button = screen.getByRole("button", { name: /Connect to Stripe/i });
      button.click();

      await waitFor(() => {
        expect(screen.getByText(/Not authenticated/i)).toBeDefined();
      });
    });
  });

  describe("Platform branching", () => {
    it("uses different code paths for native vs web", async () => {
      const mocks = mockCapacitorPlugins();

      vi.resetModules();
      vi.doMock("@/app/settings/stripe-connect-actions", () => ({
        startStripeOnboarding: vi.fn(async () => ({
          url: "https://connect.stripe.com/setup/test",
        })),
        refreshStripeStatus: vi.fn(async () => ({ success: true })),
      }));

      const { StripeConnectSection } = await import(
        "@/app/settings/stripe-connect-section"
      );

      // Test native path
      mockNativePlatform(true);
      const { unmount } = render(
        <StripeConnectSection
          stripeAccountId={null}
          stripePayoutsEnabled={false}
          stripeRequirementsDue={false}
        />,
      );

      const nativeButton = screen.getByRole("button", {
        name: /Connect to Stripe/i,
      });
      nativeButton.click();

      await waitFor(() => {
        const browserCalls = mocks.Browser.getCalls();
        expect(browserCalls.some((call) => call.method === "open")).toBe(true);
      });

      unmount();

      // Clear calls and test web path
      resetCapacitorCalls();
      mockNativePlatform(false);

      const locationSpy = vi.spyOn(window.location, "href", "set");

      render(
        <StripeConnectSection
          stripeAccountId={null}
          stripePayoutsEnabled={false}
          stripeRequirementsDue={false}
        />,
      );

      const webButton = screen.getByRole("button", {
        name: /Connect to Stripe/i,
      });
      webButton.click();

      await waitFor(() => {
        expect(locationSpy).toHaveBeenCalled();
      });

      // Browser.open must not be called again on web
      const afterWebCalls = mocks.Browser.getCalls();
      expect(afterWebCalls).toHaveLength(0);

      locationSpy.mockRestore();
    });
  });
});
