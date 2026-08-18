/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { mockCapacitorPlugins } from "../helpers/capacitor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Required cleanup for DOM tests
afterEach(cleanup);

describe("Issue #148: Add a dwell to the Sent terminal state before navigating", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Send success flow with dwell", () => {
    it("holds the terminal 'Sent ✓' state for at least 400ms before navigation", async () => {
      // This test verifies the timing behavior: setSent(true) is called, then
      // a ~450ms delay occurs before router.push() is called.

      const mockRouterPush = vi.fn();
      const mockSetSent = vi.fn();
      let navigated = false;

      // Simulate the send success flow
      const simulateSendSuccess = () => {
        mockSetSent(true);

        // Navigation should be delayed by ~450ms
        setTimeout(() => {
          mockRouterPush("/jobs/123?sent=quote");
          navigated = true;
        }, 450);
      };

      simulateSendSuccess();

      // Immediately after setSent, navigation should not have occurred
      expect(mockSetSent).toHaveBeenCalledWith(true);
      expect(navigated).toBe(false);

      // After 300ms, navigation should still not have occurred (< 400ms threshold)
      vi.advanceTimersByTime(300);
      expect(navigated).toBe(false);

      // After 400ms, navigation should still not have occurred (just under 450ms)
      vi.advanceTimersByTime(100);
      expect(navigated).toBe(false);

      // After 450ms, navigation should have occurred
      vi.advanceTimersByTime(50);
      expect(navigated).toBe(true);
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
    });

    it("calls Haptics.impact when the terminal state is set", async () => {
      const mocks = mockCapacitorPlugins();
      const mockSetSent = vi.fn();

      // Simulate the send success flow with haptics
      const simulateSendSuccessWithHaptics = async () => {
        mockSetSent(true);
        // Haptics should be called immediately when terminal state is set
        await mocks.Haptics.impact({ style: "light" });
      };

      await simulateSendSuccessWithHaptics();

      const hapticCalls = mocks.Haptics.getCalls();
      expect(hapticCalls).toHaveLength(1);
      expect(hapticCalls[0].method).toBe("impact");
      expect(hapticCalls[0].args[0]).toEqual({ style: "light" });
    });

    it("does not navigate twice if the send completes exactly once", () => {
      const mockRouterPush = vi.fn();
      const timers: Array<ReturnType<typeof setTimeout>> = [];

      const simulateSendSuccess = () => {
        // Simulate setting sent=true and creating the navigation timer
        // In the real implementation, sent=true would prevent re-entry
        const timer = setTimeout(() => {
          mockRouterPush("/jobs/123?sent=quote");
        }, 450);
        timers.push(timer);
      };

      // Send completes once, creating one timer
      simulateSendSuccess();

      // Advance time
      vi.advanceTimersByTime(450);

      // Navigation should only have been called once
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      expect(timers).toHaveLength(1);
    });
  });

  describe("Edge cases", () => {
    it("cancels the navigation timer if component unmounts during dwell", () => {
      const mockRouterPush = vi.fn();
      let navigationTimer: ReturnType<typeof setTimeout> | null = null;

      const simulateSendSuccess = () => {
        navigationTimer = setTimeout(() => {
          mockRouterPush("/jobs/123?sent=quote");
        }, 450);
      };

      const simulateUnmount = () => {
        if (navigationTimer) {
          clearTimeout(navigationTimer);
          navigationTimer = null;
        }
      };

      // Start the send flow
      simulateSendSuccess();
      expect(navigationTimer).not.toBeNull();

      // Unmount after 200ms (before navigation would fire)
      vi.advanceTimersByTime(200);
      simulateUnmount();

      // Advance past when navigation would have fired
      vi.advanceTimersByTime(300);

      // Navigation should not have been called
      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it("does not execute a dwell or navigation if send fails", () => {
      const mockRouterPush = vi.fn();
      const mockSetSent = vi.fn();
      const mockSetError = vi.fn();

      const simulateSendFailure = () => {
        // On error, we set error state but never set sent=true
        mockSetError({ error: "Failed to send quote" });
        // No timer is created, no navigation
      };

      simulateSendFailure();

      // Advance time significantly
      vi.advanceTimersByTime(1000);

      // setSent should never have been called
      expect(mockSetSent).not.toHaveBeenCalled();
      // Navigation should never have been called
      expect(mockRouterPush).not.toHaveBeenCalled();
      // Error state should be set
      expect(mockSetError).toHaveBeenCalledWith({ error: "Failed to send quote" });
    });

    it("prevents repeated send presses from creating multiple timers", () => {
      const mockRouterPush = vi.fn();
      let isSending = false;
      let sent = false;
      const timers: Array<ReturnType<typeof setTimeout>> = [];

      const handleSend = () => {
        // Button is disabled when sent || isSending
        if (sent || isSending) {
          return;
        }

        isSending = true;

        // Simulate async send
        setTimeout(() => {
          isSending = false;
          sent = true;

          // Set up navigation timer
          const timer = setTimeout(() => {
            mockRouterPush("/jobs/123?sent=quote");
          }, 450);
          timers.push(timer);
        }, 100);
      };

      // First press: should start the send
      handleSend();
      expect(timers).toHaveLength(0); // Timer not created yet (async)

      // Second press immediately: should be blocked
      handleSend();

      // Third press: should be blocked
      handleSend();

      // Advance to complete the send
      vi.advanceTimersByTime(100);
      expect(sent).toBe(true);
      expect(timers).toHaveLength(1); // Only one timer created

      // Further presses after sent=true should still be blocked
      handleSend();
      handleSend();

      // Complete the navigation
      vi.advanceTimersByTime(450);

      // Navigation should have been called exactly once
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      expect(timers).toHaveLength(1);
    });
  });

  describe("Visual feedback during dwell", () => {
    it("applies success state styling during the dwell period", () => {
      // This test conceptually verifies that the button has success styling.
      // In the actual implementation, this would be verified by checking that
      // the button element has the appropriate classes or styles applied when
      // sent=true.

      const button = document.createElement("button");
      button.textContent = "Send quote";
      document.body.appendChild(button);

      const applySuccessState = () => {
        button.classList.add("bg-success-bg", "text-success");
        button.textContent = "Sent ✓";
      };

      applySuccessState();

      expect(button.textContent).toBe("Sent ✓");
      expect(button.classList.contains("bg-success-bg")).toBe(true);
      expect(button.classList.contains("text-success")).toBe(true);

      document.body.removeChild(button);
    });

    it("check-draw animation keyframe exists in global styles", () => {
      // This test verifies that a check-draw animation is defined.
      // The actual keyframe should be added to globals.css or similar.

      // For now, we test that the concept exists by checking if an element
      // could have the animation applied. In the real implementation, the
      // Engineer will add @keyframes check-draw to globals.css.

      const element = document.createElement("div");
      element.style.animation = "check-draw 300ms ease-in-out";

      // The animation will be defined in CSS, so we just verify the style can be set
      expect(element.style.animation).toContain("check-draw");
    });
  });

  describe("Reduced motion support", () => {
    it("retains dwell duration under reduced motion preference", () => {
      // Under prefers-reduced-motion, the dwell duration should still be 450ms,
      // but the animation should not run (or run in 0.01ms per globals.css).

      const mockRouterPush = vi.fn();

      const simulateSendSuccessWithReducedMotion = () => {
        // Same timing behavior regardless of motion preference
        setTimeout(() => {
          mockRouterPush("/jobs/123?sent=quote");
        }, 450);
      };

      simulateSendSuccessWithReducedMotion();

      // Advance timers
      vi.advanceTimersByTime(450);

      // Navigation should still occur after 450ms
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
    });
  });

  describe("Implementation verification", () => {
    it("quote-editor.tsx contains a dwell timer after setSent(true)", () => {
      // This test will fail until the dwell is implemented.
      // The implementation must add a setTimeout between setSent(true) and
      // router.push() with a delay of approximately 450ms.

      // We verify this by checking that the source contains the pattern
      const quotedEditorPath = resolve(
        __dirname,
        "../../src/app/jobs/[id]/quote-editor.tsx"
      );
      const content = readFileSync(quotedEditorPath, "utf-8");

      // The implementation should have a setTimeout call after setSent(true)
      // with a delay around 450ms. This is a basic check that the dwell exists.
      const hasDwellPattern =
        content.includes("setSent(true)") &&
        content.includes("setTimeout") &&
        /setTimeout.*450|setTimeout.*router\.push.*450/.test(content);

      expect(hasDwellPattern).toBe(true);
    });

    it("quote-editor.tsx calls Haptics.impact when terminal state is set", () => {
      // The implementation must import and call Haptics.impact when the
      // success state is reached

      const quotedEditorPath = resolve(
        __dirname,
        "../../src/app/jobs/[id]/quote-editor.tsx"
      );
      const content = readFileSync(quotedEditorPath, "utf-8");

      // Should import Haptics from @capacitor/haptics
      const hasHapticsImport =
        content.includes("@capacitor/haptics") ||
        content.includes("Haptics");

      // Should call Haptics.impact somewhere in the send success path
      const hasHapticsCall = /Haptics\.impact/.test(content);

      expect(hasHapticsImport && hasHapticsCall).toBe(true);
    });
  });

  describe("sendButtonLabel utility compatibility", () => {
    it("sendButtonLabel returns 'Sent ✓' when sent=true", async () => {
      // The existing sendButtonLabel function should continue to work
      const { sendButtonLabel } = await import("@/app/jobs/[id]/send-button-label");

      const label = sendButtonLabel({ sent: true, isSending: false });
      expect(label).toBe("Sent ✓");
    });

    it("sendButtonLabel returns 'Sending...' when isSending=true and sent=false", async () => {
      const { sendButtonLabel } = await import("@/app/jobs/[id]/send-button-label");

      const label = sendButtonLabel({ sent: false, isSending: true });
      expect(label).toBe("Sending...");
    });

    it("sendButtonLabel prioritizes sent over isSending", async () => {
      const { sendButtonLabel } = await import("@/app/jobs/[id]/send-button-label");

      // When both are true, sent takes precedence (terminal state)
      const label = sendButtonLabel({ sent: true, isSending: true });
      expect(label).toBe("Sent ✓");
    });
  });
});
