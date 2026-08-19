/**
 * @vitest-environment happy-dom
 *
 * Acceptance: the payment-return page must resolve.
 *
 * Stripe redirects the customer to /i/[id]/paid the moment they return from
 * their bank, before payment_intent.succeeded has settled anything. The page
 * was right to refuse to claim payment it could not see, and then stopped
 * there: a static server render, no polling, no prompt to reload. A customer
 * who HAD paid saw "pending" indefinitely; a customer whose payment FAILED was
 * told there was nothing else they needed to do.
 *
 * It could not have polled anyway — payment_intent.processing and
 * payment_intent.payment_failed were logged to the console and written
 * nowhere, so no stored state distinguished settling from failed from
 * abandoned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

afterEach(cleanup);

const SRC = path.join(__dirname, "..", "..", "src");

// ---------------------------------------------------------------------------
// The migration and the schema separation it rests on
// ---------------------------------------------------------------------------
describe("intermediate payment state is persisted, not logged", () => {
  const migration = readFileSync(
    path.join(SRC, "..", "supabase", "migrations", "00000000000043_invoice_payment_status.sql"),
    "utf8",
  );
  const webhook = readFileSync(
    path.join(SRC, "app", "api", "stripe", "webhook", "route.ts"),
    "utf8",
  );

  it("adds payment_status and last_payment_error to invoices", () => {
    expect(migration).toContain("add column payment_status text");
    expect(migration).toContain("add column last_payment_error jsonb");
  });

  it("constrains payment_status to the two intermediate values only", () => {
    // No 'paid' value here: settled is decided by status/paid_at, and a second
    // source of truth for it is a bug waiting to happen.
    expect(migration).toMatch(/check \(payment_status in \('processing', 'failed'\)\)/);
  });

  it("leaves invoices.status — the pipeline column — untouched", () => {
    expect(migration).not.toMatch(/alter\s+column\s+status/i);
    expect(migration).not.toMatch(/drop\s+column\s+status/i);
  });

  it("writes both intermediate webhook events instead of only logging them", () => {
    expect(webhook).toContain('payment_status: "processing"');
    expect(webhook).toContain('payment_status: "failed"');
  });

  it("makes both writes no-ops on an already-paid invoice", () => {
    // A late or out-of-order 'processing' must not regress a settled invoice.
    const guards = webhook.match(/\.neq\("status", "paid"\)/g) ?? [];
    expect(guards.length).toBe(2);
  });

  it("stores only the error's message and code, never the whole PaymentIntent", () => {
    expect(webhook).toMatch(/message: error\.message \?\? null, code: error\.code \?\? null/);
    expect(webhook).not.toContain("last_payment_error: paymentIntent.last_payment_error");
  });

  it("does not touch the succeeded path's settlement call", () => {
    expect(webhook).toContain("feeCollectedAtSource: (paymentIntent.application_fee_amount ?? 0) > 0");
  });
});

// ---------------------------------------------------------------------------
// The status endpoint
// ---------------------------------------------------------------------------
const invoiceRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: invoiceRow.current, error: null }),
      };
      return b;
    },
  }),
}));

const callStatus = async (id = "inv-1") => {
  const { GET } = await import("@/app/api/invoices/[id]/payment-status/route");
  return GET({} as never, { params: Promise.resolve({ id }) });
};

describe("GET /api/invoices/[id]/payment-status", () => {
  it("404s an unknown invoice", async () => {
    invoiceRow.current = null;
    const res = await callStatus("nope");
    expect(res.status).toBe(404);
  });

  it("reports paid when status is paid", async () => {
    invoiceRow.current = { amount: 120, status: "paid", paid_at: null, payment_status: null };
    expect((await (await callStatus()).json()).state).toBe("paid");
  });

  it("reports paid when only paid_at is set, matching the receipt page's own rule", async () => {
    invoiceRow.current = {
      amount: 120,
      status: "sent",
      paid_at: "2026-08-19T10:00:00Z",
      payment_status: null,
    };
    expect((await (await callStatus()).json()).state).toBe("paid");
  });

  it("lets settlement outrank a stale processing flag", async () => {
    invoiceRow.current = {
      amount: 120,
      status: "paid",
      paid_at: null,
      payment_status: "processing",
    };
    expect((await (await callStatus()).json()).state).toBe("paid");
  });

  it.each([
    ["processing", "processing"],
    ["failed", "failed"],
    [null, "unknown"],
  ])("maps payment_status %s to state %s", async (stored, expected) => {
    invoiceRow.current = { amount: 120, status: "sent", paid_at: null, payment_status: stored };
    expect((await (await callStatus()).json()).state).toBe(expected);
  });

  it("leaks nothing beyond state, amount and paidAt", async () => {
    invoiceRow.current = { amount: 120, status: "sent", paid_at: null, payment_status: "failed" };
    const body = await (await callStatus()).json();
    expect(Object.keys(body).sort()).toEqual(["amount", "paidAt", "state"]);
  });

  it("is never cached — the value it serves changes underneath the poller", async () => {
    invoiceRow.current = { amount: 120, status: "sent", paid_at: null, payment_status: null };
    expect((await callStatus()).headers.get("Cache-Control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// The page resolves
// ---------------------------------------------------------------------------
describe("the pending page resolves in place", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  const respond = (state: string, amount: number | null = 8132) =>
    Promise.resolve({
      ok: true,
      json: async () => ({ state, amount, paidAt: null }),
    } as Response);

  it("renders the receipt in place, with no navigation, once paid", async () => {
    fetchMock.mockImplementation(() => respond("paid"));
    const { PendingStatus } = await import("@/app/i/[id]/paid/pending-status");

    render(<PendingStatus invoiceId="inv-1" companyName="Fenland Electrical" />);

    await waitFor(() => expect(screen.getByText("Payment received")).toBeTruthy());
    expect(screen.getByText(/Fenland Electrical/)).toBeTruthy();
  });

  it("stops polling once it resolves", async () => {
    // Fake timers, and deliberately NO waitFor: waitFor polls on its own
    // timers, which the fake clock freezes, so the pair deadlocks (AGENTS.md,
    // "Testing a component that rotates on a timer"). advanceTimersByTimeAsync
    // flushes the promise chain between timers and is bounded by the time
    // advanced, so it also avoids the runAllTimers abort.
    //
    // Advancing well past BOTH intervals is the point. A real-time sleep short
    // of the 3s fast interval would pass whether or not polling had stopped,
    // which asserts nothing.
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(() => respond("paid"));
      const { PendingStatus } = await import("@/app/i/[id]/paid/pending-status");

      render(<PendingStatus invoiceId="inv-1" companyName={null} />);

      await act(async () => void (await vi.advanceTimersByTimeAsync(0))); // initial poll settles
      expect(screen.getByText("Payment received")).toBeTruthy();
      expect(fetchMock.mock.calls.length).toBe(1);

      await act(async () => void (await vi.advanceTimersByTimeAsync(60_000))); // past fast AND slow intervals
      expect(fetchMock.mock.calls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up at the ceiling rather than polling forever", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(() => respond("unknown", null));
      const { PendingStatus } = await import("@/app/i/[id]/paid/pending-status");

      render(<PendingStatus invoiceId="inv-1" companyName={null} />);

      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      expect(screen.getByText("Payment pending")).toBeTruthy();

      // Past the 3-minute ceiling: the page must settle on the honest
      // still-waiting state and issue no further requests.
      await act(async () => void (await vi.advanceTimersByTimeAsync(4 * 60_000)));
      expect(screen.getByText("Still waiting on your bank")).toBeTruthy();

      const callsAtCeiling = fetchMock.mock.calls.length;
      await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
      expect(fetchMock.mock.calls.length).toBe(callsAtCeiling);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says plainly that a failed payment took nothing, and offers the retry", async () => {
    fetchMock.mockImplementation(() => respond("failed", null));
    const { PendingStatus } = await import("@/app/i/[id]/paid/pending-status");

    render(<PendingStatus invoiceId="inv-1" companyName={null} />);

    await waitFor(() => expect(screen.getByText("Payment not completed")).toBeTruthy());
    // The old copy reassured a failed payer there was nothing more to do.
    expect(screen.queryByText(/nothing else you need to do/)).toBeNull();
    const retry = screen.getByText("The invoice is still open");
    expect(retry.getAttribute("href")).toBe("/i/inv-1");
  });

  it("keeps waiting, without claiming failure, while the state is unknown", async () => {
    fetchMock.mockImplementation(() => respond("unknown", null));
    const { PendingStatus } = await import("@/app/i/[id]/paid/pending-status");

    render(<PendingStatus invoiceId="inv-1" companyName={null} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Payment pending")).toBeTruthy();
  });

  it("survives a dropped request rather than treating it as an answer", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
    const { PendingStatus } = await import("@/app/i/[id]/paid/pending-status");

    render(<PendingStatus invoiceId="inv-1" companyName={null} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Payment pending")).toBeTruthy();
  });
});

describe("an already-settled invoice never mounts the poller", () => {
  const page = readFileSync(path.join(SRC, "app", "i", "[id]", "paid", "page.tsx"), "utf8");

  it("keeps the receipt branch a server render", () => {
    expect(page).not.toContain('"use client"');
    // The settled branch renders inline; only the pending branch delegates.
    const settledFirst = page.indexOf("Payment received");
    const pendingComponent = page.indexOf("<PendingStatus");
    expect(settledFirst).toBeGreaterThan(-1);
    expect(pendingComponent).toBeGreaterThan(settledFirst);
  });
});
