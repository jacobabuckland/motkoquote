/**
 * @vitest-environment happy-dom
 *
 * Example test demonstrating DOM environment + Capacitor mocking.
 * This file opts into the DOM environment via the directive above.
 */

import { describe, it, expect } from "vitest";
import { mockNativePlatform, mockCapacitorPlugins } from "../helpers/capacitor";

describe("DOM + Capacitor example tests", () => {
  describe("Native platform path", () => {
    it("renders a component, fires interaction, and asserts plugin was called", () => {
      // Mock as native platform
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      // Create a simple DOM element to simulate a component
      const button = document.createElement("button");
      button.textContent = "Share";
      document.body.appendChild(button);

      // Simulate user interaction that triggers a Capacitor plugin
      button.addEventListener("click", async () => {
        // In real code this would be imported from @capacitor/share
        await mocks.Share.share({
          title: "Test Share",
          text: "Test content",
          url: "https://example.com",
        });
      });

      // Fire the click event
      button.click();

      // Assert the plugin was called with expected arguments
      const calls = mocks.Share.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("share");
      expect(calls[0].args[0]).toEqual({
        title: "Test Share",
        text: "Test content",
        url: "https://example.com",
      });

      // Cleanup
      document.body.removeChild(button);
    });

    it("records Haptics plugin calls", () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      // Simulate haptic feedback
      mocks.Haptics.impact({ style: "medium" });

      const calls = mocks.Haptics.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("impact");
      expect(calls[0].args[0]).toEqual({ style: "medium" });
    });
  });

  describe("Web platform path (default)", () => {
    it("asserts native guard short-circuits, plugin never called", () => {
      // Default is web (no explicit mockNativePlatform call, or pass false)
      mockNativePlatform(false);
      const mocks = mockCapacitorPlugins();

      // Simulate a guard that checks isNativePlatform
      const shouldUseNativeFeature = false; // In real code: Capacitor.isNativePlatform()

      if (shouldUseNativeFeature) {
        // This branch would not execute on web
        mocks.Haptics.impact({ style: "medium" });
      }

      // Assert plugin was never called (web path)
      const calls = mocks.Haptics.getCalls();
      expect(calls).toHaveLength(0);
    });

    it("can render DOM elements even without native features", () => {
      // This test doesn't use any native features, but still has DOM access
      const div = document.createElement("div");
      div.className = "test-element";
      div.textContent = "Hello DOM";
      document.body.appendChild(div);

      const found = document.querySelector(".test-element");
      expect(found).not.toBeNull();
      expect(found?.textContent).toBe("Hello DOM");

      document.body.removeChild(div);
    });
  });

  describe("Call record isolation", () => {
    it("first test makes a call", () => {
      const mocks = mockCapacitorPlugins();
      mocks.App.getInfo();

      expect(mocks.App.getCalls()).toHaveLength(1);
    });

    it("second test sees no calls from first test (records reset)", () => {
      const mocks = mockCapacitorPlugins();

      // Should start with no calls (beforeEach reset)
      expect(mocks.App.getCalls()).toHaveLength(0);
    });
  });
});
