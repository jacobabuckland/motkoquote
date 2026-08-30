/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// UI-1: the send-invoice button must land on "Sent ✓" before router.push fires,
// so a slow or wedged navigation cannot strand the control mid-spin. The pattern
// is documented in CLAUDE.md and already implemented in create-contract-form.tsx.

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const createInvoice = vi.fn(
  async (): Promise<{
    invoiceId: string;
    paymentUrl: string | null;
    delivered: boolean;
    payoutSetupRequired: boolean;
  }> => ({
    invoiceId: "invoice-1",
    paymentUrl: "https://example.test/i/invoice-1",
    delivered: true,
    payoutSetupRequired: false,
  }),
);
vi.mock("@/app/dashboard/actions", () => ({ createInvoice }));

afterEach(() => {
  cleanup();
  push.mockClear();
  push.mockImplementation(() => {});
  createInvoice.mockClear();
  createInvoice.mockImplementation(
    async (): Promise<{
      invoiceId: string;
      paymentUrl: string | null;
      delivered: boolean;
      payoutSetupRequired: boolean;
    }> => ({
      invoiceId: "invoice-1",
      paymentUrl: "https://example.test/i/invoice-1",
      delivered: true,
      payoutSetupRequired: false,
    }),
  );
  vi.useRealTimers();
});

const sendAnInvoice = async (jobId?: string) => {
  const { CreateInvoiceForm } = await import("@/app/dashboard/create-invoice-form");
  render(
    <CreateInvoiceForm
      quoteId="quote-1"
      quoteTotal={1500}
      jobId={jobId}
      customerName="Test Customer"
    />,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send invoice" }));
  });
};

describe("send invoice", () => {
  it("lands on Sent ✓ before it navigates", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    await sendAnInvoice("job-1");

    // The window in which a wedged push would strand the button on a spinner.
    expect(screen.getByRole("button", { name: "Sent ✓" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sending…" })).toBeNull();
    expect(push).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(push).toHaveBeenCalledWith("/jobs/job-1?sent=invoice");
  });

  it("stays on Sent ✓ when the navigation never completes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    push.mockImplementation(() => {
      // A push that wedges — the exact case the pattern exists for.
      return new Promise(() => {}) as unknown as void;
    });

    await sendAnInvoice("job-1");
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByRole("button", { name: "Sent ✓" })).toBeDefined();
  });

  it("cannot be sent twice from the terminal state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    await sendAnInvoice("job-1");
    const button = screen.getByRole("button", { name: "Sent ✓" });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(createInvoice).toHaveBeenCalledTimes(1);
  });

  it("pushes the right URL for a successful send", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    await sendAnInvoice("job-1");
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(push).toHaveBeenCalledWith("/jobs/job-1?sent=invoice");
  });

  it("pushes the right URL when nothing was delivered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    createInvoice.mockResolvedValueOnce({
      invoiceId: "invoice-1",
      paymentUrl: "https://example.test/i/invoice-1",
      delivered: false,
      payoutSetupRequired: false,
    });

    await sendAnInvoice("job-1");
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(push).toHaveBeenCalledWith("/jobs/job-1?sent=invoice&delivered=0");
  });

  it("pushes the right URL when payout setup is required", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    createInvoice.mockResolvedValueOnce({
      invoiceId: "invoice-1",
      paymentUrl: "https://example.test/i/invoice-1",
      delivered: true,
      payoutSetupRequired: true,
    });

    await sendAnInvoice("job-1");
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(push).toHaveBeenCalledWith("/jobs/job-1?sent=invoice&payout=setup");
  });

  it("pushes the right URL when nothing delivered and payout setup required", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    createInvoice.mockResolvedValueOnce({
      invoiceId: "invoice-1",
      paymentUrl: "https://example.test/i/invoice-1",
      delivered: false,
      payoutSetupRequired: true,
    });

    await sendAnInvoice("job-1");
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(push).toHaveBeenCalledWith("/jobs/job-1?sent=invoice&delivered=0&payout=setup");
  });

  it("does not reach terminal state on failure", async () => {
    createInvoice.mockRejectedValueOnce(new Error("Network error"));

    await sendAnInvoice("job-1");

    // Error is shown, button stays usable, no "Sent ✓"
    expect(screen.getByText("Network error")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sent ✓" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send invoice" })).toBeDefined();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not show terminal state or navigate when there is no jobId", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Render without jobId
    await sendAnInvoice(undefined);

    // No terminal label
    expect(screen.queryByRole("button", { name: "Sent ✓" })).toBeNull();

    // No navigation
    expect(push).not.toHaveBeenCalled();

    // Inline result is displayed
    expect(screen.getByText(/Invoice sent to Test Customer/)).toBeDefined();

    // Even after time advances, still no navigation
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(push).not.toHaveBeenCalled();
  });
});
