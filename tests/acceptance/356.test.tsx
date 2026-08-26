/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { mockNativePlatform, mockCapacitorPlugins } from "../helpers/capacitor";

// Required. The vitest config does not set `globals: true`, so Testing
// Library's automatic cleanup never registers itself, and without this each
// test's markup stays in document.body for the next test's query to find.
afterEach(cleanup);

describe("Issue #356: Use the native share sheet for the referral link", () => {
  describe("ShareLinkButton integration", () => {
    it("exists as an importable component", async () => {
      const mod = await import("@/components/ui/share-link-button");
      expect(mod.ShareLinkButton).toBeDefined();
    });
  });

  describe("ReferralSection with referral code", () => {
    it("renders Copy code button on both platforms", async () => {
      const { ReferralSection } = await import("@/app/settings/referral-section");
      const { ToastProvider } = await import("@/components/ui/toast");

      render(
        <ToastProvider>
          <ReferralSection
            referralCode="ABC123"
            appUrl="https://motko.app"
          />
        </ToastProvider>
      );

      expect(screen.getByText("Copy code")).toBeDefined();
    });

    it("Copy code button copies the bare code on click", async () => {
      const { ReferralSection } = await import("@/app/settings/referral-section");
      const { ToastProvider } = await import("@/components/ui/toast");

      // Mock clipboard API
      const clipboardWriteText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: clipboardWriteText },
        writable: true,
      });

      render(
        <ToastProvider>
          <ReferralSection
            referralCode="ABC123"
            appUrl="https://motko.app"
          />
        </ToastProvider>
      );

      const copyCodeButton = screen.getByText("Copy code");
      fireEvent.click(copyCodeButton);

      // Wait a tick for async clipboard call
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(clipboardWriteText).toHaveBeenCalledWith("ABC123");
    });

    it("on native platform: link row offers share action that calls Share.share", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      const { ReferralSection } = await import("@/app/settings/referral-section");
      const { ToastProvider } = await import("@/components/ui/toast");

      render(
        <ToastProvider>
          <ReferralSection
            referralCode="ABC123"
            appUrl="https://motko.app"
          />
        </ToastProvider>
      );

      // Find the share button by its label
      const shareButton = screen.getByText("Share link");
      expect(shareButton).toBeDefined();

      // Click the share button
      fireEvent.click(shareButton);

      // Verify Share.share was called with the referral link
      const shareCalls = mocks.Share.getCalls();
      expect(shareCalls).toHaveLength(1);
      expect(shareCalls[0].method).toBe("share");
      expect(shareCalls[0].args[0]).toMatchObject({
        url: "https://motko.app/signup?ref=ABC123",
      });
    });

    it("on web platform: link row offers copy action, not share", async () => {
      mockNativePlatform(false);
      mockCapacitorPlugins();

      const { ReferralSection } = await import("@/app/settings/referral-section");
      const { ToastProvider } = await import("@/components/ui/toast");

      // Mock clipboard API
      const clipboardWriteText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: clipboardWriteText },
        writable: true,
      });

      render(
        <ToastProvider>
          <ReferralSection
            referralCode="ABC123"
            appUrl="https://motko.app"
          />
        </ToastProvider>
      );

      // The button label is still "Share link" but behavior is copy on web
      const button = screen.getByText("Share link");
      expect(button).toBeDefined();

      // Click the button
      fireEvent.click(button);

      // Wait a tick for async clipboard call
      await new Promise((resolve) => setTimeout(resolve, 0));

      // On web, it should copy to clipboard instead of calling Share.share
      expect(clipboardWriteText).toHaveBeenCalledWith(
        "https://motko.app/signup?ref=ABC123"
      );
    });

    it("on native platform: triggers haptic feedback on share", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      const { ReferralSection } = await import("@/app/settings/referral-section");
      const { ToastProvider } = await import("@/components/ui/toast");

      render(
        <ToastProvider>
          <ReferralSection
            referralCode="ABC123"
            appUrl="https://motko.app"
          />
        </ToastProvider>
      );

      const shareButton = screen.getByText("Share link");
      fireEvent.click(shareButton);

      // Verify haptic feedback was triggered
      const hapticCalls = mocks.Haptics.getCalls();
      expect(hapticCalls.length).toBeGreaterThan(0);
      expect(hapticCalls[0].method).toBe("impact");
    });
  });

  describe("ReferralSection without referral code", () => {
    it("shows placeholder message when referral code is null", async () => {
      const { ReferralSection } = await import("@/app/settings/referral-section");
      const { ToastProvider } = await import("@/components/ui/toast");

      render(
        <ToastProvider>
          <ReferralSection
            referralCode={null}
            appUrl="https://motko.app"
          />
        </ToastProvider>
      );

      expect(
        screen.getByText(/Your referral code will appear here once/)
      ).toBeDefined();
    });

    it("does not render any copy or share buttons when code is null", async () => {
      const { ReferralSection } = await import("@/app/settings/referral-section");
      const { ToastProvider } = await import("@/components/ui/toast");

      render(
        <ToastProvider>
          <ReferralSection
            referralCode={null}
            appUrl="https://motko.app"
          />
        </ToastProvider>
      );

      expect(screen.queryByText("Copy code")).toBeNull();
      expect(screen.queryByText("Share link")).toBeNull();
    });
  });

  describe("Comment correction", () => {
    it("source comment states the correct reward progression", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");

      const filePath = path.join(
        process.cwd(),
        "src/app/settings/referral-section.tsx"
      );
      const source = fs.readFileSync(filePath, "utf-8");

      // The comment should mention "+3, rising to 5" not just "+5"
      // Check that the comment near the top references the rising progression
      const commentMatch = source.match(
        /The referrer's \+(\d+)[,\s]+rising to (\d+)/i
      );

      expect(commentMatch, "Comment should state the reward progression").toBeTruthy();
      expect(commentMatch?.[1]).toBe("3");
      expect(commentMatch?.[2]).toBe("5");
    });
  });
});
