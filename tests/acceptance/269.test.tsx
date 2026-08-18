/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

describe("#269: Branded loading state on app launch", () => {
  it("displays the lowercase motko wordmark", async () => {
    const { AppLoadingScreen } = await import("@/components/app-loading-screen");

    render(<AppLoadingScreen />);

    // Wordmark must be exactly lowercase "motko"
    const wordmark = screen.getByText("motko");
    expect(wordmark).toBeDefined();
  });

  it("displays a loading spinner", async () => {
    const { AppLoadingScreen } = await import("@/components/app-loading-screen");

    render(<AppLoadingScreen />);

    // Spinner should have role="status" for accessibility
    const spinner = screen.queryByRole("status");
    expect(spinner).not.toBeNull();
  });

  it("cycles through at least three distinct status messages", async () => {
    vi.useFakeTimers();

    const { AppLoadingScreen } = await import("@/components/app-loading-screen");

    render(<AppLoadingScreen />);

    const messages = new Set<string>();

    // Capture initial message
    const firstMessage = screen.getByText(/Loading/i).textContent;
    if (firstMessage) {
      messages.add(firstMessage);
    }

    // Advance through several intervals to capture distinct messages
    // Using 2s intervals (within the 1.5-2.5s range)
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(2000);

      await waitFor(() => {
        const currentMessage = screen.getByText(/Loading/i).textContent;
        if (currentMessage) {
          messages.add(currentMessage);
        }
      });
    }

    // Must have at least 3 distinct messages
    expect(messages.size).toBeGreaterThanOrEqual(3);

    vi.useRealTimers();
  });

  it("rotates messages at an interval between 1.5 and 2.5 seconds", async () => {
    vi.useFakeTimers();

    const { AppLoadingScreen } = await import("@/components/app-loading-screen");

    render(<AppLoadingScreen />);

    const initialMessage = screen.getByText(/Loading/i).textContent;

    // At 1 second, message should not have changed yet (below minimum 1.5s)
    vi.advanceTimersByTime(1000);
    expect(screen.getByText(/Loading/i).textContent).toBe(initialMessage);

    // By 2.5 seconds, message must have changed (at or below maximum)
    vi.advanceTimersByTime(1500); // Total: 2.5s

    await waitFor(() => {
      const newMessage = screen.getByText(/Loading/i).textContent;
      expect(newMessage).not.toBe(initialMessage);
    });

    vi.useRealTimers();
  });

  it("is available as the Next.js app loading component", async () => {
    const loadingMod = await import("@/app/loading");

    // Next.js loading.tsx must have a default export
    expect(loadingMod.default).toBeDefined();

    render(<loadingMod.default />);

    // Should show the motko wordmark when used as loading.tsx
    expect(screen.getByText("motko")).toBeDefined();
  });

  it("shows expected status messages about app content", async () => {
    vi.useFakeTimers();

    const { AppLoadingScreen } = await import("@/components/app-loading-screen");

    render(<AppLoadingScreen />);

    const observedMessages = new Set<string>();

    // Collect messages over multiple rotation cycles
    for (let i = 0; i < 6; i++) {
      const currentMessage = screen.getByText(/Loading/i).textContent;
      if (currentMessage) {
        observedMessages.add(currentMessage);
      }
      vi.advanceTimersByTime(2000);
      await waitFor(() => screen.getByText(/Loading/i));
    }

    // Should include messages about quotes, contracts, or bills
    // (the spec mentions these as examples)
    const messagesArray = Array.from(observedMessages);
    const hasRelevantContent = messagesArray.some(msg =>
      /quotes?|contracts?|bills?/i.test(msg)
    );

    expect(hasRelevantContent).toBe(true);

    vi.useRealTimers();
  });
});
