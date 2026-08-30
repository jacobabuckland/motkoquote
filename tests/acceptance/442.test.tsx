/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { MarkPaidResult } from "@/app/jobs/[id]/mark-paid-actions";

afterEach(cleanup);

// Mock modules before importing the component
vi.mock("@/app/jobs/[id]/mark-paid-actions", () => ({
  markInvoicePaid: vi.fn(async (): Promise<MarkPaidResult> => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
  })),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/haptics", () => ({
  success: vi.fn(),
  error: vi.fn(),
  tap: vi.fn(),
}));

describe("UI-2: Mark as paid settled end-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("MarkAsPaidButton", () => {
    it("shows 'Paid ✓' before navigation after successful mark-paid", async () => {
      const { markInvoicePaid } = await import("@/app/jobs/[id]/mark-paid-actions");
      const { useRouter } = await import("next/navigation");
      const { MarkAsPaidButton } = await import("@/app/jobs/[id]/mark-as-paid-button");

      const mockPush = vi.fn();
      vi.mocked(useRouter).mockReturnValue({
        push: mockPush,
        refresh: vi.fn(),
      } as never);

      vi.mocked(markInvoicePaid).mockResolvedValue({ ok: true });

      render(
        <MarkAsPaidButton
          invoiceId="invoice-123"
          jobId="job-456"
          customerName="Alice"
          freeJobsRemaining={3}
          quoteTotal={500}
        />,
      );

      // Open the modal
      const triggerButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      fireEvent.click(triggerButtons[0]);

      // Select payment method and confirm
      const cashButton = screen.getByRole("button", { name: "Cash" });
      fireEvent.click(cashButton);

      // After the modal opens, there are now two "Mark as paid" buttons - click the second one (in the dialog)
      const allButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      // Only the confirm click is wrapped, so the action settles while the
      // 450ms dwell timer stays pending — draining it here would fire the very
      // navigation this test asserts has not happened.
      await act(async () => {
        fireEvent.click(allButtons[1]);
      });

      // The button should read "Paid ✓" before any navigation
      const paidButton = screen.getByRole("button", { name: "Paid ✓" });
      expect(paidButton).toBeDefined();

      // Navigation should not have been called yet (still in dwell period)
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("navigates to /jobs/[jobId]?sent=paid after dwell period", async () => {
      const { markInvoicePaid } = await import("@/app/jobs/[id]/mark-paid-actions");
      const { useRouter } = await import("next/navigation");
      const { MarkAsPaidButton } = await import("@/app/jobs/[id]/mark-as-paid-button");

      const mockPush = vi.fn();
      vi.mocked(useRouter).mockReturnValue({
        push: mockPush,
        refresh: vi.fn(),
      } as never);

      vi.mocked(markInvoicePaid).mockResolvedValue({ ok: true });

      render(
        <MarkAsPaidButton
          invoiceId="invoice-123"
          jobId="job-456"
          customerName="Alice"
          freeJobsRemaining={3}
          quoteTotal={500}
        />,
      );

      const triggerButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      fireEvent.click(triggerButtons[0]);
      const cashButton = screen.getByRole("button", { name: "Cash" });
      fireEvent.click(cashButton);
      const allButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      fireEvent.click(allButtons[1]);

      await vi.runAllTimersAsync();

      // After dwell period (~450ms), navigation should fire
      expect(mockPush).toHaveBeenCalledWith("/jobs/job-456?sent=paid");
    });

    it("shows 'Paid ✓' even when router.push hangs", async () => {
      const { markInvoicePaid } = await import("@/app/jobs/[id]/mark-paid-actions");
      const { useRouter } = await import("next/navigation");
      const { MarkAsPaidButton } = await import("@/app/jobs/[id]/mark-as-paid-button");

      // Push that never resolves
      const hangingPush = vi.fn(() => new Promise(() => {}));
      vi.mocked(useRouter).mockReturnValue({
        push: hangingPush,
        refresh: vi.fn(),
      } as never);

      vi.mocked(markInvoicePaid).mockResolvedValue({ ok: true });

      render(
        <MarkAsPaidButton
          invoiceId="invoice-123"
          jobId="job-456"
          customerName="Alice"
          freeJobsRemaining={3}
          quoteTotal={500}
        />,
      );

      const triggerButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      fireEvent.click(triggerButtons[0]);
      const cashButton = screen.getByRole("button", { name: "Cash" });
      fireEvent.click(cashButton);
      const allButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      fireEvent.click(allButtons[1]);

      await vi.runAllTimersAsync();

      // Even with a hanging push, the button should show "Paid ✓"
      const paidButton = screen.getByRole("button", { name: "Paid ✓" });
      expect(paidButton).toBeDefined();
      expect(paidButton).toHaveAttribute("disabled");
    });

    it("returns to 'Mark as paid' on error, keeps modal open, no navigation", async () => {
      const { markInvoicePaid } = await import("@/app/jobs/[id]/mark-paid-actions");
      const { useRouter } = await import("next/navigation");
      const { MarkAsPaidButton } = await import("@/app/jobs/[id]/mark-as-paid-button");

      const mockPush = vi.fn();
      vi.mocked(useRouter).mockReturnValue({
        push: mockPush,
        refresh: vi.fn(),
      } as never);

      vi.mocked(markInvoicePaid).mockResolvedValue({
        error: "We couldn't find that invoice.",
      });

      render(
        <MarkAsPaidButton
          invoiceId="invoice-123"
          jobId="job-456"
          customerName="Alice"
          freeJobsRemaining={3}
          quoteTotal={500}
        />,
      );

      const triggerButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      fireEvent.click(triggerButtons[0]);
      const cashButton = screen.getByRole("button", { name: "Cash" });
      fireEvent.click(cashButton);
      const allButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      await act(async () => {
        fireEvent.click(allButtons[1]);
      });
      await waitFor(() =>
        expect(screen.getByText("We couldn't find that invoice.")).toBeDefined(),
      );

      // Button should be back to "Mark as paid", not disabled (query within dialog)
      const dialog = screen.getByRole("dialog");
      const markPaidButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      const dialogButton = markPaidButtons.find((btn) => dialog.contains(btn));
      expect(dialogButton).toBeDefined();
      expect(dialogButton).not.toHaveAttribute("disabled");

      // Error message should be visible
      expect(screen.getByText("We couldn't find that invoice.")).toBeDefined();

      // Modal should still be open (dialog role still present)
      expect(screen.getByRole("dialog")).toBeDefined();

      // No navigation should have been attempted
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("clears navigation timer on unmount", async () => {
      const { markInvoicePaid } = await import("@/app/jobs/[id]/mark-paid-actions");
      const { useRouter } = await import("next/navigation");
      const { MarkAsPaidButton } = await import("@/app/jobs/[id]/mark-as-paid-button");

      const mockPush = vi.fn();
      vi.mocked(useRouter).mockReturnValue({
        push: mockPush,
        refresh: vi.fn(),
      } as never);

      vi.mocked(markInvoicePaid).mockResolvedValue({ ok: true });

      const { unmount } = render(
        <MarkAsPaidButton
          invoiceId="invoice-123"
          jobId="job-456"
          customerName="Alice"
          freeJobsRemaining={3}
          quoteTotal={500}
        />,
      );

      const triggerButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      fireEvent.click(triggerButtons[0]);
      const cashButton = screen.getByRole("button", { name: "Cash" });
      fireEvent.click(cashButton);
      const allButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      fireEvent.click(allButtons[1]);

      // Don't wait for timers — unmount immediately
      unmount();

      // Now advance timers
      await vi.runAllTimersAsync();

      // Navigation should never have been called because timer was cleared
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("accepts jobId prop and uses it in navigation", async () => {
      const { markInvoicePaid } = await import("@/app/jobs/[id]/mark-paid-actions");
      const { useRouter } = await import("next/navigation");
      const { MarkAsPaidButton } = await import("@/app/jobs/[id]/mark-as-paid-button");

      const mockPush = vi.fn();
      vi.mocked(useRouter).mockReturnValue({
        push: mockPush,
        refresh: vi.fn(),
      } as never);

      vi.mocked(markInvoicePaid).mockResolvedValue({ ok: true });

      render(
        <MarkAsPaidButton
          invoiceId="invoice-123"
          jobId="different-job-789"
          customerName="Bob"
          freeJobsRemaining={5}
          quoteTotal={1200}
        />,
      );

      const triggerButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      fireEvent.click(triggerButtons[0]);
      const cashButton = screen.getByRole("button", { name: "Cash" });
      fireEvent.click(cashButton);
      const allButtons = screen.getAllByRole("button", { name: "Mark as paid" });
      fireEvent.click(allButtons[1]);

      await vi.runAllTimersAsync();

      // Should use the provided jobId
      expect(mockPush).toHaveBeenCalledWith("/jobs/different-job-789?sent=paid");
    });
  });

  describe("buildSentBanner", () => {
    it("returns a banner for sent=paid with link:null", async () => {
      const mod = await import("@/app/jobs/[id]/sent-banner");

      const result = mod.buildSentBanner({
        sent: "paid",
        delivered: undefined,
        payout: undefined,
        firstName: "Alice",
        channelSuffix: "",
        quoteUrl: null,
        contractUrl: null,
        paymentUrl: null,
      });

      expect(result).not.toBeNull();
      expect(result?.title).toContain("paid");
      expect(result?.link).toBeNull();
    });

    it("returns null for unrecognised sent value", async () => {
      const mod = await import("@/app/jobs/[id]/sent-banner");

      const result = mod.buildSentBanner({
        sent: "unknown-value",
        delivered: undefined,
        payout: undefined,
        firstName: "Alice",
        channelSuffix: "",
        quoteUrl: null,
        contractUrl: null,
        paymentUrl: null,
      });

      expect(result).toBeNull();
    });

    it("still handles quote/contract/invoice sent values correctly", async () => {
      const mod = await import("@/app/jobs/[id]/sent-banner");

      const quote = mod.buildSentBanner({
        sent: "quote",
        delivered: undefined,
        payout: undefined,
        firstName: "Alice",
        channelSuffix: " (email)",
        quoteUrl: "https://example.com/q/123",
        contractUrl: null,
        paymentUrl: null,
      });

      expect(quote).not.toBeNull();
      expect(quote?.title).toContain("Quote sent");
      expect(quote?.link).toBe("https://example.com/q/123");
    });
  });

  describe("Call site integration", () => {
    it("mark-as-paid-button.tsx exists and exports MarkAsPaidButton", async () => {
      const mod = await import("@/app/jobs/[id]/mark-as-paid-button");
      expect(mod.MarkAsPaidButton).toBeDefined();
    });

    it("sent-banner.ts exists and exports buildSentBanner", async () => {
      const mod = await import("@/app/jobs/[id]/sent-banner");
      expect(mod.buildSentBanner).toBeDefined();
    });

    it("mark-paid-actions.ts exists and exports the expected types", async () => {
      const mod = await import("@/app/jobs/[id]/mark-paid-actions");
      expect(mod.markInvoicePaid).toBeDefined();
      // Type exports are not runtime values, so we can't assert them directly,
      // but the test will fail to compile if they're missing
    });
  });
});
