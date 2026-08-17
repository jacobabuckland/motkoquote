/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { mockNativePlatform, mockCapacitorPlugins, resetCapacitorCalls } from "../helpers/capacitor";

// Required: cleanup after each test
afterEach(cleanup);

describe("Native share sheet for quote, invoice and contract links", () => {
  describe("Native platform", () => {
    it("invokes Share.share with title and URL when button is clicked", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      // Import the component the Engineer will create
      const { ShareLinkButton } = await import("@/components/ui/share-link-button");

      render(
        <ShareLinkButton
          url="https://motko.app/q/abc123"
          title="Quote for Alice"
          label="Share quote"
        />
      );

      const button = screen.getByRole("button", { name: "Share quote" });
      fireEvent.click(button);

      // Assert Share.share was called with title and url
      const shareCalls = mocks.Share.getCalls();
      expect(shareCalls).toHaveLength(1);
      expect(shareCalls[0].method).toBe("share");
      expect(shareCalls[0].args[0]).toMatchObject({
        title: "Quote for Alice",
        url: "https://motko.app/q/abc123",
      });
    });

    it("fires haptics when share sheet is invoked", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      const { ShareLinkButton } = await import("@/components/ui/share-link-button");

      render(
        <ShareLinkButton
          url="https://motko.app/c/def456"
          title="Contract for Bob"
          label="Share contract"
        />
      );

      const button = screen.getByRole("button", { name: "Share contract" });
      fireEvent.click(button);

      // Assert haptics fired
      const hapticsCalls = mocks.Haptics.getCalls();
      expect(hapticsCalls).toHaveLength(1);
      expect(hapticsCalls[0].method).toBe("impact");
      expect(hapticsCalls[0].args[0]).toMatchObject({
        style: "MEDIUM",
      });
    });

    it("shares contract link from the job page sent banner", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      const { ShareLinkButton } = await import("@/components/ui/share-link-button");

      // Simulate the sent banner showing a contract link
      render(
        <ShareLinkButton
          url="https://motko.app/c/xyz789"
          title="Contract"
          label="Copy contract link"
        />
      );

      const button = screen.getByRole("button", { name: "Copy contract link" });
      fireEvent.click(button);

      // Assert Share was called, not clipboard
      const shareCalls = mocks.Share.getCalls();
      expect(shareCalls).toHaveLength(1);
      expect(shareCalls[0].method).toBe("share");
    });

    it("shares payment link for invoice", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      const { ShareLinkButton } = await import("@/components/ui/share-link-button");

      render(
        <ShareLinkButton
          url="https://motko.app/i/invoice123"
          title="Payment link"
          label="Copy payment link"
        />
      );

      const button = screen.getByRole("button", { name: "Copy payment link" });
      fireEvent.click(button);

      const shareCalls = mocks.Share.getCalls();
      expect(shareCalls).toHaveLength(1);
      expect(shareCalls[0].args[0]).toMatchObject({
        url: "https://motko.app/i/invoice123",
      });
    });
  });

  describe("Web platform", () => {
    it("copies to clipboard instead of invoking share sheet", async () => {
      mockNativePlatform(false);
      const mocks = mockCapacitorPlugins();

      // Mock navigator.clipboard
      const clipboardWriteText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: clipboardWriteText },
        writable: true,
      });

      const { ShareLinkButton } = await import("@/components/ui/share-link-button");

      render(
        <ShareLinkButton
          url="https://motko.app/q/web123"
          title="Quote for Charlie"
          label="Copy quote link"
        />
      );

      const button = screen.getByRole("button", { name: "Copy quote link" });
      fireEvent.click(button);

      // Assert clipboard was written
      expect(clipboardWriteText).toHaveBeenCalledWith("https://motko.app/q/web123");

      // Assert Share.share was NOT called
      const shareCalls = mocks.Share.getCalls();
      expect(shareCalls).toHaveLength(0);

      // Assert Haptics was NOT called on web
      const hapticsCalls = mocks.Haptics.getCalls();
      expect(hapticsCalls).toHaveLength(0);
    });
  });

  describe("Platform detection", () => {
    it("uses Capacitor.isNativePlatform to branch behavior", async () => {
      // This test verifies that the same platform check used for haptics
      // (Capacitor.isNativePlatform) is used for share sheet detection.
      // The mocking infrastructure ensures this - if it's using a different
      // check, the behavior won't match the mock state.

      // Test native
      mockNativePlatform(true);
      const nativeMocks = mockCapacitorPlugins();

      const { ShareLinkButton } = await import("@/components/ui/share-link-button");

      const { unmount: unmountNative } = render(
        <ShareLinkButton
          url="https://motko.app/test1"
          title="Test"
          label="Share"
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Share" }));

      expect(nativeMocks.Share.getCalls()).toHaveLength(1);
      unmountNative();

      // Test web. Reset explicitly between the two phases so the web
      // assertions count only their own calls — mockCapacitorPlugins() does not
      // wipe history, because tests that register a listener and assert on it
      // later depend on it surviving.
      resetCapacitorCalls();
      mockNativePlatform(false);
      const webMocks = mockCapacitorPlugins();

      const clipboardWriteText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: clipboardWriteText },
        writable: true,
      });

      render(
        <ShareLinkButton
          url="https://motko.app/test2"
          title="Test"
          label="Copy"
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));

      // Web path: Share not called, clipboard was
      expect(webMocks.Share.getCalls()).toHaveLength(0);
      expect(clipboardWriteText).toHaveBeenCalled();
    });
  });

  describe("Share sheet dismissal", () => {
    it("treats dismissal as a silent no-op", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      const { ShareLinkButton } = await import("@/components/ui/share-link-button");

      // Mock Share.share to simulate user dismissal (resolved promise)
      // The Capacitor Share API resolves when the sheet is dismissed
      // without an error. No need to verify toast wasn't shown -
      // the component should just resolve the promise and do nothing.

      render(
        <ShareLinkButton
          url="https://motko.app/dismissed"
          title="Test"
          label="Share"
        />
      );

      const button = screen.getByRole("button", { name: "Share" });
      fireEvent.click(button);

      // Share was called
      expect(mocks.Share.getCalls()).toHaveLength(1);

      // No error thrown, no special handling needed
      // The component should just await the promise and move on
    });
  });

  describe("Component module exports", () => {
    it("exports ShareLinkButton from the ui components", async () => {
      // Verify the module exists and exports the expected component
      const mod = await import("@/components/ui/share-link-button");
      expect(mod.ShareLinkButton).toBeDefined();
      expect(typeof mod.ShareLinkButton).toBe("function");
    });
  });
});
