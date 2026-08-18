/**
 * @vitest-environment happy-dom
 *
 * Issue #178: Detect offline from failed fetches rather than navigator.onLine
 *
 * These tests verify that the offline banner appears based on consecutive
 * fetch failures, not just navigator.onLine, and correctly distinguishes
 * between network failures and server errors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { OfflineBanner } from "@/components/ui/offline-banner";

afterEach(cleanup);

describe("Issue #178: Detect offline from failed fetches", () => {
  let originalFetch: typeof global.fetch;
  let originalOnLine: boolean;

  beforeEach(() => {
    // Store original fetch and navigator.onLine
    originalFetch = global.fetch;
    originalOnLine = navigator.onLine;

    // Mock navigator.onLine as true by default (override per test)
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: true,
    });

    // Mock fetch as successful by default
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({}),
    });
  });

  afterEach(async () => {
    // Restore original fetch and navigator.onLine
    global.fetch = originalFetch;
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: originalOnLine,
    });

    // The monitor's consecutive-failure count is module state, so without this
    // one test's failures carry into the next and the banner appears earlier
    // than the test under way asked for.
    const { resetFetchMonitor } = await import("@/lib/fetch-monitor");
    resetFetchMonitor();
  });

  describe("Fetch monitor exists and is consumable", () => {
    it("fetch monitor module exists at src/lib/fetch-monitor.ts", async () => {
      // This will fail until the Engineer creates the module
      const mod = await import("@/lib/fetch-monitor");
      expect(mod).toBeDefined();
    });

    it("fetch monitor exports a way to track fetch failures", async () => {
      const mod = await import("@/lib/fetch-monitor");

      // The module should export some mechanism for tracking failures
      // (exact API is up to Engineer, but it must exist)
      expect(typeof mod.reportFetchFailure === "function" ||
             typeof mod.initFetchMonitor === "function" ||
             typeof mod.useFetchMonitor === "function").toBe(true);
    });

    it("fetch monitor exports a way to track fetch successes", async () => {
      const mod = await import("@/lib/fetch-monitor");

      // The module should export some mechanism for tracking successes
      expect(typeof mod.reportFetchSuccess === "function" ||
             typeof mod.initFetchMonitor === "function" ||
             typeof mod.useFetchMonitor === "function").toBe(true);
    });
  });

  describe("Banner appears after consecutive fetch failures", () => {
    it("banner does not appear after a single fetch failure", async () => {
      render(<OfflineBanner />);

      // Simulate one network failure
      const failedFetch = Promise.reject(new Error("Network error"));
      global.fetch = vi.fn().mockReturnValue(failedFetch);

      // Trigger a fetch (the component must listen to global fetches)
      try {
        await fetch("/api/test");
      } catch {
        // Expected to fail
      }

      // Wait a moment for any state updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Banner should NOT appear after single failure
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("banner appears after two consecutive fetch failures", async () => {
      render(<OfflineBanner />);

      // Simulate two consecutive network failures
      const failedFetch = Promise.reject(new Error("Network error"));
      global.fetch = vi.fn().mockReturnValue(failedFetch);

      // Trigger two fetches
      try {
        await fetch("/api/test-1");
      } catch {
        // Expected
      }
      try {
        await fetch("/api/test-2");
      } catch {
        // Expected
      }

      // Wait for banner to appear
      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeInTheDocument();
      });
    });

    it("banner appears after three consecutive fetch failures", async () => {
      render(<OfflineBanner />);

      // Simulate three consecutive network failures
      const failedFetch = Promise.reject(new Error("Network error"));
      global.fetch = vi.fn().mockReturnValue(failedFetch);

      // Trigger three fetches
      try {
        await fetch("/api/test-1");
      } catch {
        // Expected
      }
      try {
        await fetch("/api/test-2");
      } catch {
        // Expected
      }
      try {
        await fetch("/api/test-3");
      } catch {
        // Expected
      }

      // Wait for banner to appear
      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeInTheDocument();
      });
    });
  });

  describe("Banner does not appear for server errors", () => {
    it("500 server error does not trigger offline banner", async () => {
      render(<OfflineBanner />);

      // Simulate multiple 500 responses
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ error: "Internal server error" }),
      });

      // Trigger multiple fetches that return 500
      await fetch("/api/test-1");
      await fetch("/api/test-2");
      await fetch("/api/test-3");

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Banner should NOT appear (500 means network is working)
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("503 service unavailable does not trigger offline banner", async () => {
      render(<OfflineBanner />);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ error: "Service unavailable" }),
      });

      await fetch("/api/test-1");
      await fetch("/api/test-2");

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("401 unauthorized does not trigger offline banner", async () => {
      render(<OfflineBanner />);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ error: "Unauthorized" }),
      });

      await fetch("/api/test-1");
      await fetch("/api/test-2");

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("404 not found does not trigger offline banner", async () => {
      render(<OfflineBanner />);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ error: "Not found" }),
      });

      await fetch("/api/test-1");
      await fetch("/api/test-2");

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("Captive portal detection", () => {
    it("HTML response when expecting JSON is treated as offline", async () => {
      render(<OfflineBanner />);

      // Captive portal returns HTML with 200 status
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text: vi.fn().mockResolvedValue("<!DOCTYPE html><html>...</html>"),
      });

      // Trigger two consecutive fetches expecting JSON but getting HTML
      await fetch("/api/test-1");
      await fetch("/api/test-2");

      // Banner should appear (captive portal detected)
      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeInTheDocument();
      });
    });

    it("204 No Content is a success, not a captive portal", async () => {
      render(<OfflineBanner />);

      // 204 is the ordinary success status for a DELETE or a bodyless PUT.
      // Treating it as a network failure meant two successful deletes told the
      // user they were offline. A captive portal is detected by the
      // content-type mismatch above, which is the signal that actually
      // distinguishes an interception; a bare 204 does not.
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
        text: vi.fn().mockResolvedValue(""),
      });

      await fetch("/api/test-1");
      await fetch("/api/test-2");

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("Banner clears on successful fetch", () => {
    it("banner disappears after a successful fetch following failures", async () => {
      render(<OfflineBanner />);

      // Start with failures to show the banner
      const failedFetch = Promise.reject(new Error("Network error"));
      global.fetch = vi.fn().mockReturnValue(failedFetch);

      try {
        await fetch("/api/test-1");
      } catch {
        // Expected
      }
      try {
        await fetch("/api/test-2");
      } catch {
        // Expected
      }

      // Wait for banner to appear
      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeInTheDocument();
      });

      // Now simulate recovery with a successful fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await fetch("/api/test-success");

      // Banner should disappear
      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      });
    });
  });

  describe("Single failure followed by success does not show banner", () => {
    it("one failure then one success keeps banner hidden", async () => {
      render(<OfflineBanner />);

      // First fetch fails
      const failedFetch = Promise.reject(new Error("Network error"));
      global.fetch = vi.fn().mockReturnValue(failedFetch);

      try {
        await fetch("/api/test-1");
      } catch {
        // Expected
      }

      // Second fetch succeeds
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({}),
      });

      await fetch("/api/test-2");

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Banner should NOT have appeared
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("navigator.onLine still works as immediate signal", () => {
    it("banner appears immediately when navigator.onLine is false", async () => {
      // Set navigator.onLine to false before rendering
      Object.defineProperty(navigator, "onLine", {
        writable: true,
        value: false,
      });

      render(<OfflineBanner />);

      // Banner should appear immediately without waiting for fetch failures
      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeInTheDocument();
      });
    });

    it("banner appears when navigator.onLine changes to false", async () => {
      render(<OfflineBanner />);

      // Initially no banner
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      // Simulate going offline
      Object.defineProperty(navigator, "onLine", {
        writable: true,
        value: false,
      });

      // Dispatch offline event
      window.dispatchEvent(new Event("offline"));

      // Banner should appear
      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeInTheDocument();
      });
    });

    it("banner disappears when navigator.onLine changes to true after being offline", async () => {
      // Start offline
      Object.defineProperty(navigator, "onLine", {
        writable: true,
        value: false,
      });

      render(<OfflineBanner />);

      // Banner should be visible
      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeInTheDocument();
      });

      // Go back online
      Object.defineProperty(navigator, "onLine", {
        writable: true,
        value: true,
      });

      window.dispatchEvent(new Event("online"));

      // Banner should disappear
      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      });
    });
  });

  describe("Aborted requests are not counted as failures", () => {
    it("aborted fetch does not contribute to offline detection", async () => {
      render(<OfflineBanner />);

      // Simulate an aborted fetch
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";

      global.fetch = vi.fn().mockRejectedValue(abortError);

      try {
        await fetch("/api/test-1");
      } catch {
        // Expected
      }
      try {
        await fetch("/api/test-2");
      } catch {
        // Expected
      }

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Banner should NOT appear (aborted requests don't count)
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("Mixed success and failure resets counter", () => {
    it("failure, failure, success, failure, failure does not show banner", async () => {
      render(<OfflineBanner />);

      // Two failures
      const failedFetch = Promise.reject(new Error("Network error"));
      global.fetch = vi.fn().mockReturnValue(failedFetch);

      try {
        await fetch("/api/fail-1");
      } catch {
        // Expected
      }
      try {
        await fetch("/api/fail-2");
      } catch {
        // Expected
      }

      // Success resets counter
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({}),
      });

      await fetch("/api/success");

      // Two more failures (but counter was reset)
      global.fetch = vi.fn().mockReturnValue(failedFetch);

      try {
        await fetch("/api/fail-3");
      } catch {
        // Expected
      }
      try {
        await fetch("/api/fail-4");
      } catch {
        // Expected
      }

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Banner should appear now (two consecutive failures after reset)
      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeInTheDocument();
      });
    });
  });
});
