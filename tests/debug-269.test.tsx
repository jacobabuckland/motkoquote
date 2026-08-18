/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";

afterEach(cleanup);

describe("Debug test for #269 timer behavior", () => {
  it("advances timers and checks state synchronously", async () => {
    vi.useFakeTimers();

    const { AppLoadingScreen } = await import("@/components/app-loading-screen");

    render(<AppLoadingScreen />);

    // Get initial message
    const initialMessage = screen.getByText(/Loading/i).textContent;
    console.log("Initial message:", initialMessage);

    // Advance 1 second - should NOT change (interval is 2s)
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/Loading/i).textContent).toBe(initialMessage);
    console.log("After 1s:", screen.getByText(/Loading/i).textContent);

    // Advance another 1.5 seconds (total 2.5s) - SHOULD change
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    const newMessage = screen.getByText(/Loading/i).textContent;
    console.log("After 2.5s:", newMessage);

    expect(newMessage).not.toBe(initialMessage);

    vi.useRealTimers();
  });
});
