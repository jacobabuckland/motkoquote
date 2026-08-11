/**
 * @vitest-environment happy-dom
 *
 * Acceptance tests for issue #127: Add exit animation and success variant to Toast
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { act } from "react";

afterEach(cleanup);

// Test harness component that exposes the toast function via a button
const ToastTester = ({
  message,
  variant,
}: {
  message: string;
  variant?: "default" | "success" | "error";
}) => {
  const toast = useToast();
  return (
    <button
      onClick={() => {
        if (variant !== undefined) {
          toast(message, { variant });
        } else {
          toast(message);
        }
      }}
    >
      Show toast
    </button>
  );
};

describe("Issue #127: Toast exit animation and variants", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Visual variants", () => {
    it("renders success variant with green background and checkmark", () => {
      render(
        <ToastProvider>
          <ToastTester message="Payment received" variant="success" />
        </ToastProvider>
      );

      screen.getByRole("button", { name: "Show toast" }).click();

      const toast = screen.getByText("Payment received");
      expect(toast).toBeTruthy();

      // Should have green styling (success color)
      const toastElement = toast.closest("div");
      const styles = window.getComputedStyle(toastElement!);
      const bgColor = styles.backgroundColor;

      // CSS var --success is #15803d (rgb(21, 128, 61))
      // Accept slight variations due to browser rendering
      expect(
        bgColor.includes("21") || bgColor.includes("green") || bgColor.includes("128")
      ).toBe(true);

      // Should contain checkmark glyph
      expect(
        toastElement!.textContent?.includes("✓") ||
          toastElement!.textContent?.includes("✔")
      ).toBe(true);
    });

    it("renders error variant with red background and warning glyph", () => {
      render(
        <ToastProvider>
          <ToastTester message="Payment failed" variant="error" />
        </ToastProvider>
      );

      screen.getByRole("button", { name: "Show toast" }).click();

      const toast = screen.getByText("Payment failed");
      expect(toast).toBeTruthy();

      // Should have red/error styling
      const toastElement = toast.closest("div");
      const styles = window.getComputedStyle(toastElement!);
      const bgColor = styles.backgroundColor;

      // CSS var --error is #b91c1c (rgb(185, 28, 28))
      expect(
        bgColor.includes("185") || bgColor.includes("red") || bgColor.includes("28")
      ).toBe(true);

      // Should contain warning glyph
      expect(
        toastElement!.textContent?.includes("⚠") ||
          toastElement!.textContent?.includes("!") ||
          toastElement!.textContent?.includes("⚡")
      ).toBe(true);
    });

    it("renders default variant with grey background and no icon", () => {
      render(
        <ToastProvider>
          <ToastTester message="Settings saved" variant="default" />
        </ToastProvider>
      );

      screen.getByRole("button", { name: "Show toast" }).click();

      const toast = screen.getByText("Settings saved");
      const toastElement = toast.closest("div");

      // Should use foreground color (current grey appearance)
      const styles = window.getComputedStyle(toastElement!);
      const bgColor = styles.backgroundColor;
      expect(
        bgColor.includes("34") || // #222222 is rgb(34, 34, 34)
          bgColor.includes("foreground")
      ).toBe(true);

      // Should NOT contain icon glyphs
      const text = toastElement!.textContent || "";
      expect(text.includes("✓")).toBe(false);
      expect(text.includes("✔")).toBe(false);
      expect(text.includes("⚠")).toBe(false);
      // Should only contain the message
      expect(text.trim()).toBe("Settings saved");
    });

    it("renders with no variant as default grey with no icon", () => {
      render(
        <ToastProvider>
          <ToastTester message="Auto-saved" />
        </ToastProvider>
      );

      screen.getByRole("button", { name: "Show toast" }).click();

      const toast = screen.getByText("Auto-saved");
      const toastElement = toast.closest("div");

      // Should match default styling
      const text = toastElement!.textContent || "";
      expect(text.includes("✓")).toBe(false);
      expect(text.includes("⚠")).toBe(false);
      expect(text.trim()).toBe("Auto-saved");
    });
  });

  describe("Exit animation", () => {
    it("keeps element in DOM during exit animation and removes after transition completes", async () => {
      render(
        <ToastProvider>
          <ToastTester message="Exiting" />
        </ToastProvider>
      );

      act(() => {
        screen.getByRole("button", { name: "Show toast" }).click();
      });

      // Toast should be visible
      expect(screen.getByText("Exiting")).toBeTruthy();

      // Advance time to just before the 3s auto-dismiss
      act(() => {
        vi.advanceTimersByTime(2900);
      });

      // Should still be visible
      expect(screen.queryByText("Exiting")).toBeTruthy();

      // Advance to the auto-dismiss moment (3000ms)
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Element should STILL be in DOM (exit animation playing)
      // The exit animation should be in progress, not instant removal
      const toastElement = screen.queryByText("Exiting");
      expect(toastElement).toBeTruthy();

      // Simulate the exit animation completing
      // CSS var --dur-fast should be fast (likely 150ms or similar)
      // We'll wait for a transitionend event or a reasonable animation duration
      await act(async () => {
        vi.advanceTimersByTime(200); // Generous buffer for exit animation

        // Fire a transitionend event to signal animation completion
        const event = new Event("transitionend");
        toastElement?.closest("div")?.dispatchEvent(event);
      });

      // Now the element should be removed from DOM
      await waitFor(
        () => {
          expect(screen.queryByText("Exiting")).toBeNull();
        },
        { timeout: 500 }
      );
    });

    it("plays exit animation even when enter animation is still ongoing", async () => {
      render(
        <ToastProvider>
          <ToastTester message="Quick exit" />
        </ToastProvider>
      );

      act(() => {
        screen.getByRole("button", { name: "Show toast" }).click();
      });

      // Immediately after showing, start the 3s countdown
      // If we advance exactly 3000ms, the exit should trigger even if enter is ongoing
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // Element should still exist (in exit animation)
      const toastElement = screen.queryByText("Quick exit");
      expect(toastElement).toBeTruthy();

      // After exit animation completes, it should be removed
      await act(async () => {
        vi.advanceTimersByTime(200);
        const event = new Event("transitionend");
        toastElement?.closest("div")?.dispatchEvent(event);
      });

      await waitFor(() => {
        expect(screen.queryByText("Quick exit")).toBeNull();
      });
    });
  });

  describe("Sequential toast presentation", () => {
    it("shows second toast only after first toast exits completely", async () => {
      const TestComponent = () => {
        const toast = useToast();
        return (
          <div>
            <button
              onClick={() => {
                toast("First toast");
                // Immediately queue a second toast
                setTimeout(() => toast("Second toast"), 10);
              }}
            >
              Show two toasts
            </button>
          </div>
        );
      };

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      act(() => {
        screen.getByRole("button", { name: "Show two toasts" }).click();
        vi.advanceTimersByTime(10);
      });

      // First toast should be visible
      expect(screen.queryByText("First toast")).toBeTruthy();

      // Second toast should NOT be visible yet (waiting for first to exit)
      expect(screen.queryByText("Second toast")).toBeNull();

      // Advance to first toast's auto-dismiss
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // First toast in exit animation, second still waiting
      expect(screen.queryByText("First toast")).toBeTruthy();
      expect(screen.queryByText("Second toast")).toBeNull();

      // Complete first toast's exit animation
      await act(async () => {
        const firstToast = screen.queryByText("First toast");
        vi.advanceTimersByTime(200);
        const event = new Event("transitionend");
        firstToast?.closest("div")?.dispatchEvent(event);
      });

      // Now second toast should enter
      await waitFor(() => {
        expect(screen.queryByText("First toast")).toBeNull();
        expect(screen.queryByText("Second toast")).toBeTruthy();
      });
    });
  });

  describe("Reduced motion", () => {
    it("applies instant transitions under prefers-reduced-motion", async () => {
      // Mock prefers-reduced-motion
      const mediaQuery = {
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      };

      vi.spyOn(window, "matchMedia").mockImplementation((query) => {
        if (query === "(prefers-reduced-motion: reduce)") {
          return mediaQuery as MediaQueryList;
        }
        return {
          matches: false,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
        } as MediaQueryList;
      });

      render(
        <ToastProvider>
          <ToastTester message="Reduced motion" />
        </ToastProvider>
      );

      act(() => {
        screen.getByRole("button", { name: "Show toast" }).click();
      });

      const toast = screen.getByText("Reduced motion");

      // Under reduced motion, animations should be instant (CSS handles this)
      // We verify that the sequencing still works even with instant transitions
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // Element should be removed nearly instantly (reduced motion)
      // The CSS @media rule sets animation/transition-duration to 0.01ms
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // Toast should be gone or about to be gone
      await waitFor(
        () => {
          expect(screen.queryByText("Reduced motion")).toBeNull();
        },
        { timeout: 100 }
      );
    });

    it("maintains sequential presentation even with instant transitions", async () => {
      // Mock prefers-reduced-motion
      const mediaQuery = {
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      };

      vi.spyOn(window, "matchMedia").mockImplementation((query) => {
        if (query === "(prefers-reduced-motion: reduce)") {
          return mediaQuery as MediaQueryList;
        }
        return {
          matches: false,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
        } as MediaQueryList;
      });

      const TestComponent = () => {
        const toast = useToast();
        return (
          <button
            onClick={() => {
              toast("First");
              setTimeout(() => toast("Second"), 10);
            }}
          >
            Queue two
          </button>
        );
      };

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      act(() => {
        screen.getByRole("button", { name: "Queue two" }).click();
        vi.advanceTimersByTime(10);
      });

      // Even with reduced motion, toasts should still be sequential
      expect(screen.queryByText("First")).toBeTruthy();
      expect(screen.queryByText("Second")).toBeNull();

      // After first exits (instant), second should appear
      act(() => {
        vi.advanceTimersByTime(3000);
        vi.advanceTimersByTime(10); // Allow for reduced-motion cleanup
      });

      await waitFor(() => {
        expect(screen.queryByText("First")).toBeNull();
        expect(screen.queryByText("Second")).toBeTruthy();
      });
    });
  });

  describe("Edge cases", () => {
    it("handles empty message with variant gracefully", () => {
      render(
        <ToastProvider>
          <ToastTester message="" variant="success" />
        </ToastProvider>
      );

      act(() => {
        screen.getByRole("button", { name: "Show toast" }).click();
      });

      // Should render the icon even with empty message
      // Find the toast container (it won't have text to query by)
      const container = document.querySelector('[aria-live="polite"]');
      expect(container).toBeTruthy();

      const toastElement = container?.querySelector("div");
      expect(toastElement).toBeTruthy();

      // Should have checkmark
      expect(
        toastElement!.textContent?.includes("✓") ||
          toastElement!.textContent?.includes("✔")
      ).toBe(true);
    });

    it("does not error or leak when provider unmounts mid-exit", async () => {
      const TestWrapper = ({ show }: { show: boolean }) => {
        if (!show) return null;
        return (
          <ToastProvider>
            <ToastTester message="Unmounting" />
          </ToastProvider>
        );
      };

      const { rerender } = render(<TestWrapper show={true} />);

      act(() => {
        screen.getByRole("button", { name: "Show toast" }).click();
      });

      expect(screen.getByText("Unmounting")).toBeTruthy();

      // Start the exit animation
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // Unmount the provider mid-exit
      rerender(<TestWrapper show={false} />);

      // Should not throw or cause issues
      expect(screen.queryByText("Unmounting")).toBeNull();

      // Clean up any remaining timers
      act(() => {
        vi.runAllTimers();
      });

      // No errors should be thrown
    });
  });

  describe("CSS timing tokens", () => {
    it("defines --ease-out and --dur-fast in the document", () => {
      // This test verifies that the CSS variables exist in globals.css
      // We check the computed style on the root element
      const root = document.documentElement;
      const styles = window.getComputedStyle(root);

      // These variables should be defined after implementation
      const easeOut = styles.getPropertyValue("--ease-out");
      const durFast = styles.getPropertyValue("--dur-fast");

      expect(easeOut).toBeTruthy();
      expect(easeOut.trim().length).toBeGreaterThan(0);

      expect(durFast).toBeTruthy();
      expect(durFast.trim().length).toBeGreaterThan(0);

      // --dur-fast should be a time value (ends with ms or s)
      expect(
        durFast.includes("ms") || durFast.includes("s")
      ).toBe(true);
    });
  });
});
