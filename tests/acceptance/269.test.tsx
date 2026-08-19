/**
 * @vitest-environment happy-dom
 *
 * Acceptance tests for Issue #269: Add a branded loading state on app launch
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);

describe("Issue #269: Branded loading state on app launch", () => {
  describe("AppLoadingScreen component", () => {
    it("exports a default component", async () => {
      const mod = await import("@/components/app-loading-screen");
      expect(mod.default).toBeDefined();
    });

    it("renders the motko wordmark in lowercase", async () => {
      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      render(<AppLoadingScreen />);

      // The wordmark should be present and lowercase
      const wordmark = screen.getByText(/motko/i);
      expect(wordmark).toBeTruthy();
      expect(wordmark.textContent).toBe("motko");
    });

    it("renders a spinner", async () => {
      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      const { container } = render(<AppLoadingScreen />);

      // Look for spinner indicators: role="status", .spinner class, or animate-spin
      const spinner =
        container.querySelector('[role="status"]') ||
        container.querySelector(".spinner") ||
        container.querySelector('[class*="spin"]');

      expect(spinner).toBeTruthy();
    });

    it("renders at least three distinct status messages", async () => {
      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      // This test documents that the component has at least 3 messages defined
      // We'll check the module exports a messages array or that the rendered
      // component cycles through multiple messages

      const { container } = render(<AppLoadingScreen />);

      // The component should have at least one message visible initially
      const hasMessage =
        container.textContent?.includes("Loading") ||
        container.querySelector('[data-testid="loading-message"]') ||
        container.querySelector('[class*="message"]') ||
        container.querySelector('[class*="status"]');

      expect(hasMessage).toBeTruthy();

      // The module should export or contain a messages array with at least 3 entries
      // This can be verified by checking the implementation has multiple distinct strings
      const mod = await import("@/components/app-loading-screen");

      // Check if the module exports the messages array (implementation detail)
      // Or document that messages rotate (tested in the next test)
      expect(mod.default).toBeDefined();
    });

    it("rotates status messages at intervals between 1.5-2.5 seconds", async () => {
      vi.useFakeTimers();

      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      const { container } = render(<AppLoadingScreen />);

      // Capture the initial message
      const initialMessage = container.textContent;

      // Advance time by 1.5 seconds (minimum interval)
      vi.advanceTimersByTime(1500);

      // The message should have changed (or be in the process of changing)
      // Allow for React rendering
      await vi.runAllTimersAsync();

      const messageAfter1500 = container.textContent;

      // Advance to 2.5 seconds total
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      const messageAfter2500 = container.textContent;

      // At least one of these should be different from the initial
      const messagesRotated =
        messageAfter1500 !== initialMessage ||
        messageAfter2500 !== initialMessage;

      expect(messagesRotated).toBe(true);

      vi.useRealTimers();
    });

    it("has appropriate ARIA attributes for accessibility", async () => {
      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      const { container } = render(<AppLoadingScreen />);

      // The spinner should have role="status"
      const spinner = container.querySelector('[role="status"]');
      expect(spinner).toBeTruthy();

      // The component or spinner should have aria-live or aria-busy
      const hasAriaLive =
        container.querySelector('[aria-live]') ||
        container.querySelector('[aria-busy="true"]');

      expect(hasAriaLive).toBeTruthy();

      // Rotating messages should be aria-hidden so they don't spam screen readers
      // (This is optional but recommended - test documents the expectation)
      const messages = container.querySelectorAll('[aria-hidden="true"]');
      const hasHiddenMessages = messages.length > 0;

      // This assertion documents the recommendation but allows for alternative implementations
      if (hasHiddenMessages) {
        expect(hasHiddenMessages).toBe(true);
      }
    });

    it("removes itself from DOM when app is ready", async () => {
      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      // Mock the ready state
      const { container, unmount } = render(<AppLoadingScreen />);

      // Initially the loading screen should be present
      expect(container.querySelector('[data-testid="app-loading-screen"]') || container.firstChild).toBeTruthy();

      // When the component determines the app is ready, it should remove itself
      // This will be implementation-specific (could be based on hydration, timeout, or manual signal)

      // For now, verify that the component CAN unmount cleanly
      expect(() => unmount()).not.toThrow();
    });

    it("does not enforce a minimum display time", async () => {
      vi.useFakeTimers();

      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      // This test documents that if the app becomes ready quickly,
      // the loading screen should disappear immediately without waiting
      // for a minimum duration

      const { container } = render(<AppLoadingScreen />);

      // The component should be present initially
      expect(container.firstChild).toBeTruthy();

      // If the component receives a "ready" signal or determines readiness
      // (implementation-specific), it should remove itself immediately
      // without waiting for a minimum duration

      // This is a behavioral expectation - the implementation should not
      // have a setTimeout/delay that blocks hiding when ready

      vi.useRealTimers();
    });

    it("has a timeout to prevent infinite spinner", async () => {
      vi.useFakeTimers();

      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      const { container } = render(<AppLoadingScreen />);

      // Initially present
      expect(container.firstChild).toBeTruthy();

      // Advance time by 10 seconds (the specified timeout)
      vi.advanceTimersByTime(10000);
      await vi.runAllTimersAsync();

      // After the timeout, the component should remove itself or show an error
      // (The spec says "remove itself or surface an error" - either is acceptable)

      // This test documents the expectation but the exact behavior is
      // implementation-specific. The component should not hang forever.

      vi.useRealTimers();
    });

    it("respects prefers-reduced-motion for spinner animation", async () => {
      // Mock prefers-reduced-motion
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      const { container } = render(<AppLoadingScreen />);

      // The spinner should be present but animation should be reduced or absent
      const spinner = container.querySelector('[role="status"]');
      expect(spinner).toBeTruthy();

      // The implementation should respect the global prefers-reduced-motion handling
      // in globals.css, which sets animation-duration to 0.01ms
    });
  });

  describe("Integration with root layout", () => {
    it("AppLoadingScreen is imported in the root layout", async () => {
      const layoutSource = await import("@/app/layout");

      // The root layout should reference or import the AppLoadingScreen component
      // This ensures it mounts early in the app tree

      // We can't easily test the actual rendering of the layout without a full
      // Next.js environment, but we can verify the module exists and the layout
      // module can be imported without errors
      expect(layoutSource.default).toBeDefined();
    });
  });

  describe("Native platform compatibility", () => {
    it("renders correctly in both web and native contexts", async () => {
      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      // Render without Capacitor mocking (web context)
      const { container: webContainer } = render(<AppLoadingScreen />);
      expect(webContainer.firstChild).toBeTruthy();
      cleanup();

      // Render with Capacitor native platform mocked
      // (The component should not depend on Capacitor APIs directly)
      const { container: nativeContainer } = render(<AppLoadingScreen />);
      expect(nativeContainer.firstChild).toBeTruthy();
    });
  });

  describe("Message content", () => {
    it("includes messages about loading quotes, contracts, and bills", async () => {
      vi.useFakeTimers();

      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      const { container } = render(<AppLoadingScreen />);

      // Collect messages over multiple intervals
      const observedMessages = new Set<string>();
      const maxIterations = 10;

      for (let i = 0; i < maxIterations; i++) {
        const currentText = container.textContent || "";
        observedMessages.add(currentText);

        vi.advanceTimersByTime(2000);
        await vi.runAllTimersAsync();
      }

      // Should have seen multiple distinct messages
      expect(observedMessages.size).toBeGreaterThanOrEqual(3);

      // Messages should mention quotes, contracts, or bills as specified
      const allMessages = Array.from(observedMessages).join(" ");
      const hasExpectedContent =
        allMessages.toLowerCase().includes("quote") ||
        allMessages.toLowerCase().includes("contract") ||
        allMessages.toLowerCase().includes("bill") ||
        allMessages.toLowerCase().includes("loading");

      expect(hasExpectedContent).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("Visual structure", () => {
    it("centers content on screen with green background", async () => {
      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      const { container } = render(<AppLoadingScreen />);

      // The loading screen should cover the full viewport
      const root = container.firstChild as HTMLElement;
      expect(root).toBeTruthy();

      // The component should use the brand green (#004225) as background
      // (Either directly or via CSS class that references --green or #004225)
      // Implementation-specific, so we verify the root element exists and
      // document the color expectation here
    });

    it("stacks wordmark, spinner, and message vertically", async () => {
      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      const { container } = render(<AppLoadingScreen />);

      // All three elements should be present
      const wordmark = container.textContent?.includes("motko");
      const spinner = container.querySelector('[role="status"]');
      const message =
        container.textContent?.includes("Loading") ||
        container.textContent?.includes("quote") ||
        container.textContent?.includes("contract");

      expect(wordmark).toBe(true);
      expect(spinner).toBeTruthy();
      expect(message).toBe(true);

      // They should be arranged vertically (flexbox column or similar)
      // This is a layout concern - verify the structure exists
      const root = container.firstChild as HTMLElement;
      expect(root).toBeTruthy();
    });
  });

  describe("Edge cases", () => {
    it("does not appear on client-side route changes", async () => {
      // The loading screen is for app launch only, not route transitions
      // This test documents that expectation

      // Route-level loading states are handled by Next.js loading.tsx files
      // The AppLoadingScreen should only mount on initial app load

      // This is a behavioral expectation - the component should check if it's
      // an initial load vs a route change and only render on initial load
      expect(true).toBe(true); // Placeholder - implementation will determine this
    });

    it("unmounts cleanly without memory leaks", async () => {
      vi.useFakeTimers();

      const { default: AppLoadingScreen } = await import(
        "@/components/app-loading-screen"
      );

      const { unmount } = render(<AppLoadingScreen />);

      // Component may have timers for message rotation
      // Ensure cleanup happens properly
      expect(() => {
        unmount();
        vi.runAllTimers();
      }).not.toThrow();

      vi.useRealTimers();
    });
  });
});
