/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  getLocalDateString,
  getLocalDateBefore,
  resolveManualPaidAt,
  MAX_BACKDATE_DAYS,
} from "@/lib/mark-paid-date";
import { MarkAsPaidButton } from "@/app/jobs/[id]/mark-as-paid-button";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(() => undefined),
    refresh: vi.fn(() => undefined),
  }),
}));

// Mock toast
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(() => undefined),
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("local date helper", () => {
  it("returns yyyy-mm-dd format with zero-padding", () => {
    // 2026-03-05 09:30:00 UTC
    const epoch = Date.UTC(2026, 2, 5, 9, 30, 0);
    const result = getLocalDateString(epoch);

    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // In UTC timezone (what the test env uses), this should be 2026-03-05
    expect(result).toBe("2026-03-05");
  });

  it("returns a date MAX_BACKDATE_DAYS before the given epoch", () => {
    // 2026-07-15 12:00:00 UTC
    const epoch = Date.UTC(2026, 6, 15, 12, 0, 0);
    const result = getLocalDateBefore(epoch, MAX_BACKDATE_DAYS);

    // 90 days before 2026-07-15 is 2026-04-16
    expect(result).toBe("2026-04-16");
  });

  it("handles single-digit months and days with zero-padding", () => {
    // 2026-01-05 10:00:00 UTC (January 5)
    const epoch = Date.UTC(2026, 0, 5, 10, 0, 0);
    const result = getLocalDateString(epoch);

    expect(result).toBe("2026-01-05");
  });

  it("computes from local date components, not millisecond subtraction", () => {
    // Test across a DST boundary if applicable
    // 2026-11-01 12:00:00 UTC (after typical DST ends)
    const epoch = Date.UTC(2026, 10, 1, 12, 0, 0);
    const result = getLocalDateBefore(epoch, 30);

    // 30 calendar days before Nov 1 is Oct 2
    expect(result).toBe("2026-10-02");
  });
});

describe("integration with resolveManualPaidAt", () => {
  it("a date exactly MAX_BACKDATE_DAYS ago is accepted at 06:00 UTC", () => {
    // 2026-07-15 06:00:00 UTC
    const now = Date.UTC(2026, 6, 15, 6, 0, 0);
    const minDate = getLocalDateBefore(now, MAX_BACKDATE_DAYS);

    const result = resolveManualPaidAt(minDate, now, MAX_BACKDATE_DAYS);

    expect(result).not.toBeNull();
  });

  it("a date exactly MAX_BACKDATE_DAYS ago is accepted at 18:00 UTC", () => {
    // 2026-07-15 18:00:00 UTC (past noon, the case that fails today)
    const now = Date.UTC(2026, 6, 15, 18, 0, 0);
    const minDate = getLocalDateBefore(now, MAX_BACKDATE_DAYS);

    const result = resolveManualPaidAt(minDate, now, MAX_BACKDATE_DAYS);

    expect(result).not.toBeNull();
  });

  it("the earliest offered date is accepted at various times", () => {
    const times = [
      Date.UTC(2026, 6, 15, 0, 0, 0), // midnight UTC
      Date.UTC(2026, 6, 15, 6, 0, 0), // 06:00 UTC
      Date.UTC(2026, 6, 15, 12, 0, 0), // noon UTC
      Date.UTC(2026, 6, 15, 18, 0, 0), // 18:00 UTC
      Date.UTC(2026, 6, 15, 23, 59, 59), // end of day UTC
    ];

    times.forEach((now) => {
      const minDate = getLocalDateBefore(now, MAX_BACKDATE_DAYS);
      const result = resolveManualPaidAt(minDate, now, MAX_BACKDATE_DAYS);

      expect(result, `at ${new Date(now).toISOString()}`).not.toBeNull();
    });
  });

  it("today is always offered — test at 23:30 UTC during BST", () => {
    // 2026-07-14 23:30:00 UTC
    // During BST (UTC+1), local time is 2026-07-15 00:30:00
    // getLocalDateString should return the LOCAL date, not the UTC date
    const now = Date.UTC(2026, 6, 14, 23, 30, 0);

    // Mock the timezone offset to simulate BST (UTC+1 = -60 minutes)
    const originalOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function () {
      return -60; // BST is UTC+1
    };

    const maxDate = getLocalDateString(now);

    // Restore original
    Date.prototype.getTimezoneOffset = originalOffset;

    // In BST, 23:30 UTC is 00:30 local (next day)
    // So the local date should be 2026-07-15
    expect(maxDate).toBe("2026-07-15");
  });

  it("the offered window is exactly MAX_BACKDATE_DAYS wide", () => {
    const now = Date.UTC(2026, 7, 30, 12, 0, 0);
    const minDate = getLocalDateBefore(now, MAX_BACKDATE_DAYS);
    const maxDate = getLocalDateString(now);

    // Parse both dates
    const minEpoch = new Date(minDate).getTime();
    const maxEpoch = new Date(maxDate).getTime();

    // The difference should be exactly MAX_BACKDATE_DAYS in calendar days
    // Note: This uses Date parsing which defaults to midnight local time
    const daysDiff = Math.round((maxEpoch - minEpoch) / (24 * 60 * 60 * 1000));

    expect(daysDiff).toBe(MAX_BACKDATE_DAYS);
  });
});

describe("rendered picker", () => {
  it("uses helper for min and max attributes", () => {
    const now = Date.UTC(2026, 7, 30, 14, 0, 0);
    vi.useFakeTimers({ shouldAdvanceTime: true, now });

    const expectedMin = getLocalDateBefore(now, MAX_BACKDATE_DAYS);
    const expectedMax = getLocalDateString(now);

    render(
      <MarkAsPaidButton
        invoiceId="inv_test"
        jobId="job_test"
        customerName="Test Customer"
        freeJobsRemaining={3}
        quoteTotal={1200}
      />,
    );

    // Open the dialog
    const button = screen.getByRole("button", { name: /mark as paid/i });
    act(() => {
      fireEvent.click(button);
    });

    // Find the date input
    const dateInput = screen.getByLabelText(
      /when did they pay/i,
    ) as HTMLInputElement;

    expect(dateInput.getAttribute("min")).toBe(expectedMin);
    expect(dateInput.getAttribute("max")).toBe(expectedMax);

    vi.useRealTimers();
  });

  it("min attribute is accepted by resolveManualPaidAt at 18:00 UTC", () => {
    // This is the case that fails today — after noon UTC, the min is rejected
    const now = Date.UTC(2026, 7, 15, 18, 0, 0);
    vi.useFakeTimers({ shouldAdvanceTime: true, now });

    render(
      <MarkAsPaidButton
        invoiceId="inv_test2"
        jobId="job_test2"
        customerName="Test Customer"
        freeJobsRemaining={2}
        quoteTotal={500}
      />,
    );

    const button = screen.getByRole("button", { name: /mark as paid/i });
    act(() => {
      fireEvent.click(button);
    });

    const dateInput = screen.getByLabelText(
      /when did they pay/i,
    ) as HTMLInputElement;
    const minFromPicker = dateInput.getAttribute("min");

    expect(minFromPicker).not.toBeNull();

    // This is the key assertion: the server must accept what the picker offers
    const result = resolveManualPaidAt(minFromPicker!, now, MAX_BACKDATE_DAYS);
    expect(result).not.toBeNull();

    vi.useRealTimers();
  });

  it("max attribute offers today at 23:30 UTC during BST", () => {
    // 2026-07-14 23:30:00 UTC
    const now = Date.UTC(2026, 6, 14, 23, 30, 0);

    // Mock timezone offset for BST
    const originalOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function () {
      return -60; // BST is UTC+1
    };

    vi.useFakeTimers({ shouldAdvanceTime: true, now });

    render(
      <MarkAsPaidButton
        invoiceId="inv_test3"
        jobId="job_test3"
        customerName="Test Customer"
        freeJobsRemaining={1}
        quoteTotal={300}
      />,
    );

    const button = screen.getByRole("button", { name: /mark as paid/i });
    act(() => {
      fireEvent.click(button);
    });

    const dateInput = screen.getByLabelText(
      /when did they pay/i,
    ) as HTMLInputElement;
    const maxFromPicker = dateInput.getAttribute("max");

    // In BST, 23:30 UTC is 00:30 local (next day), so max should be 2026-07-15
    expect(maxFromPicker).toBe("2026-07-15");

    // Restore
    Date.prototype.getTimezoneOffset = originalOffset;
    vi.useRealTimers();
  });
});
