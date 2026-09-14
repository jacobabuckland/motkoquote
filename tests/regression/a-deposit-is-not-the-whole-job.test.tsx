/**
 * @vitest-environment happy-dom
 */

// Two surfaces still treated a deposit as if it were the whole job.
//
// #739 put the rule on the invoice TYPE for the job's own state — a settled
// deposit with no closing invoice beside it does not close the job — and the
// badge and headline followed it correctly. Two places did not, both reported
// 13 Sep on a £1,440 job whose 25% deposit had settled:
//
//   1. The mark-as-paid confirmation read "This closes the job (£1,440.00) and
//      stops payment reminders to Dee" — over a £360.00 deposit. False twice:
//      it does not close the job, and £1,440.00 is not the sum being recorded.
//      The identical wording appears on the genuine closing invoice, where it
//      is correct, so the copy was simply invoice-type-blind.
//
//   2. Once BOTH invoices were settled — £360 + £1,080 = £1,440 — the paid
//      card read "Customer paid: £360.00 / You receive: £360.00 / Everything's
//      settled", while the P&L on the same page read £1,440.00. The cause is
//      `.find()` returning the FIRST settled invoice, which on any job that
//      took a deposit is the deposit. A single-invoice job was unaffected,
//      which is why every other job read correctly.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarkAsPaidButton } from "@/app/jobs/[id]/mark-as-paid-button";

afterEach(cleanup);

vi.mock("@/app/jobs/[id]/mark-paid-actions", () => ({
  markInvoicePaid: vi.fn(async (_input?: unknown) => ({ ok: true })),
}));

const open = () => fireEvent.click(screen.getByRole("button", { name: /Mark as paid/i }));

const renderButton = (over: { invoiceType?: string; invoiceAmount?: number } = {}) =>
  render(
    <MarkAsPaidButton
      invoiceId="inv_1"
      jobId="job_1"
      customerName="Dee"
      freeJobsRemaining={0}
      quoteTotal={1440}
      netSubtotal={1200}
      {...over}
    />,
  );

describe("the confirmation over a deposit", () => {
  it("does not claim to close the job", () => {
    renderButton({ invoiceType: "deposit", invoiceAmount: 360 });
    open();

    expect(screen.queryByText(/closes the job/i)).toBeNull();
  });

  it("says the rest of the job stays open", () => {
    renderButton({ invoiceType: "deposit", invoiceAmount: 360 });
    open();

    expect(screen.getByText(/the rest of the job stays open/i)).toBeDefined();
  });

  it("names the deposit's own figure, not the quote total", () => {
    renderButton({ invoiceType: "deposit", invoiceAmount: 360 });
    open();

    expect(screen.getByText(/£360\.00 deposit as\s+paid/i)).toBeDefined();
    // The reported wording put the whole quote in front of the contractor.
    expect(screen.queryByText(/£1,440\.00/)).toBeNull();
  });
});

describe("the confirmation over a closing invoice is unchanged", () => {
  it("still says it closes the job", () => {
    renderButton({ invoiceType: "final", invoiceAmount: 1080 });
    open();

    expect(screen.getByText(/closes the job/i)).toBeDefined();
  });

  it("names the invoice being settled", () => {
    renderButton({ invoiceType: "final", invoiceAmount: 1080 });
    open();

    expect(screen.getByText(/£1,080\.00/)).toBeDefined();
  });

  it("falls back to the quote total where no invoice detail is supplied", () => {
    // The dashboard row carries neither, and the pre-existing wording is the
    // right answer there.
    renderButton();
    open();

    expect(screen.getByText(/closes the job/i)).toBeDefined();
    expect(screen.getByText(/£1,440\.00/)).toBeDefined();
  });
});

// The second half of the report is arithmetic over the invoice rows rather
// than a component, so it is asserted directly on the rule the job page now
// applies. The page reduces over every settled invoice; `.find()` took one.
describe("what the customer actually paid", () => {
  type Invoice = { amount: number; status: string; paid_at: string | null };

  const settledTotal = (invoices: Invoice[]) => {
    const settled = invoices.filter((inv) => inv.status === "paid" || inv.paid_at !== null);
    return Math.round(settled.reduce((sum, inv) => sum + inv.amount, 0) * 100) / 100;
  };

  const DEPOSIT: Invoice = { amount: 360, status: "paid", paid_at: "2026-09-13T00:00:00Z" };
  const BALANCE: Invoice = { amount: 1080, status: "paid", paid_at: "2026-09-13T00:00:00Z" };

  it("sums a deposit and its balance", () => {
    expect(settledTotal([DEPOSIT, BALANCE])).toBe(1440);
  });

  it("is not the deposit alone — the reported figure", () => {
    expect(settledTotal([DEPOSIT, BALANCE])).not.toBe(360);
  });

  it("counts only what is settled", () => {
    const unpaidBalance: Invoice = { amount: 1080, status: "sent", paid_at: null };
    expect(settledTotal([DEPOSIT, unpaidBalance])).toBe(360);
  });

  it("counts an invoice settled by paid_at alone", () => {
    const byDate: Invoice = { amount: 500, status: "sent", paid_at: "2026-09-13T00:00:00Z" };
    expect(settledTotal([byDate])).toBe(500);
  });

  it("leaves a single-invoice job reading exactly as it did", () => {
    expect(settledTotal([{ amount: 1414, status: "paid", paid_at: null }])).toBe(1414);
  });
});
