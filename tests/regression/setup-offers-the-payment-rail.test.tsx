/**
 * @vitest-environment happy-dom
 */

// Onboarding used to end on the dashboard with no mention of getting paid.
// Stripe Connect lived in a collapsed "Getting paid" row in Settings, and the
// first thing that told a trade about it was the banner AFTER their first
// invoice had already gone out with no way to pay it.
//
// The step is skippable on purpose, so what is worth pinning is that the offer
// and the skip both exist, that the skip really does leave, and that starting
// the flow asks for the return destination that comes back to the step rather
// than to Settings.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mockCapacitorPlugins, mockNativePlatform } from "../helpers/capacitor";

const startStripeOnboarding =
  vi.fn<(returnTo?: string) => Promise<{ url: string } | { error: string }>>(
    async (_returnTo?: string) => ({ url: "https://connect.stripe.com/setup/acct_1" }),
  );

vi.mock("@/app/settings/stripe-connect-actions", () => ({
  startStripeOnboarding: (returnTo?: string) => startStripeOnboarding(returnTo),
}));

afterEach(cleanup);

beforeEach(() => {
  startStripeOnboarding.mockClear();
  startStripeOnboarding.mockResolvedValue({
    url: "https://connect.stripe.com/setup/acct_1",
  });
  mockNativePlatform(false);
  mockCapacitorPlugins();
  // jsdom/happy-dom will not navigate, so the assignment needs somewhere to go.
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { href: "http://localhost:3000/setup/payouts" },
  });
});

const renderStep = async (started = false) => {
  const { PayoutStep } = await import("@/app/setup/payouts/payout-step");
  render(<PayoutStep started={started} />);
};

describe("the setup flow offers the payment rail", () => {
  it("offers to set up payments", async () => {
    await renderStep();

    expect(
      screen.getByRole("button", { name: "Set up payments" }),
    ).toBeDefined();
  });

  it("lets the trade skip straight to the dashboard", async () => {
    await renderStep();

    const skip = screen.getByRole("link", { name: "Skip for now" });
    expect(skip.getAttribute("href")).toBe("/dashboard");
  });

  // A skip offered with no consequence stated reads as "this doesn't matter".
  it("says what skipping costs", async () => {
    await renderStep();

    expect(screen.getByText(/any time in Settings/i)).toBeDefined();
  });

  // The return destination is the whole reason the action takes an argument.
  // Defaulting to "settings" here would drop the trade into Settings halfway
  // through setup, with the dashboard never reached.
  it("asks Stripe to return to the step, not to Settings", async () => {
    await renderStep();

    fireEvent.click(screen.getByRole("button", { name: "Set up payments" }));

    await waitFor(() => {
      expect(startStripeOnboarding).toHaveBeenCalledWith("setup");
    });
  });

  it("sends a web trade to the Stripe-hosted flow", async () => {
    await renderStep();

    fireEvent.click(screen.getByRole("button", { name: "Set up payments" }));

    await waitFor(() => {
      expect(window.location.href).toBe("https://connect.stripe.com/setup/acct_1");
    });
  });

  it("opens the Stripe flow in the in-app browser on native", async () => {
    mockNativePlatform(true);
    const mocks = mockCapacitorPlugins();
    await renderStep();

    fireEvent.click(screen.getByRole("button", { name: "Set up payments" }));

    await waitFor(() => {
      const calls = mocks.Browser.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("open");
      expect(calls[0].args[0]).toEqual({
        url: "https://connect.stripe.com/setup/acct_1",
      });
    });
  });

  it("shows the failure rather than silently doing nothing", async () => {
    startStripeOnboarding.mockResolvedValue({ error: "Stripe is not configured" });
    await renderStep();

    fireEvent.click(screen.getByRole("button", { name: "Set up payments" }));

    await waitFor(() => {
      expect(screen.getByText("Stripe is not configured")).toBeDefined();
    });
    // Still skippable: a Stripe outage must not strand anyone in setup.
    expect(
      screen.getByRole("link", { name: "Skip for now" }).getAttribute("href"),
    ).toBe("/dashboard");
  });

  it("invites a trade who stopped partway to finish", async () => {
    await renderStep(true);

    expect(
      screen.getByRole("button", { name: "Finish setting up payments" }),
    ).toBeDefined();
  });
});
