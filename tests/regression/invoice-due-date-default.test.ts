import { describe, expect, it } from "vitest";
import {
  DEFAULT_INVOICE_TERM_DAYS,
  defaultInvoiceDueDate,
} from "@/lib/invoice-due-date";
import { isInvoiceOverdue, type InvoiceState } from "@/lib/job-stages";

// Invoices were raised with due_date null whenever the optional field was left
// blank. That states no payment terms to the customer, and gives the contractor
// nothing to chase against — isInvoiceOverdue cannot fire without a due date,
// so the invoice sits unpaid and un-chased indefinitely.

describe("defaultInvoiceDueDate", () => {
  it("is the default term after the given date", () => {
    expect(defaultInvoiceDueDate(new Date("2026-08-28T09:00:00Z"))).toBe("2026-09-11");
    expect(DEFAULT_INVOICE_TERM_DAYS).toBe(14);
  });

  it("crosses month and year boundaries correctly", () => {
    expect(defaultInvoiceDueDate(new Date("2026-12-24T00:00:00Z"))).toBe("2027-01-07");
    expect(defaultInvoiceDueDate(new Date("2028-02-20T00:00:00Z"))).toBe("2028-03-05");
  });

  it("does not drift with the time of day", () => {
    // The column is a date, not a timestamp. Deriving it in local time would
    // move the due date by a day either side of midnight.
    expect(defaultInvoiceDueDate(new Date("2026-08-28T00:00:00Z"))).toBe(
      defaultInvoiceDueDate(new Date("2026-08-28T23:59:59Z")),
    );
  });

  it("produces a date an unpaid invoice can actually go overdue against", () => {
    const due = defaultInvoiceDueDate(new Date("2026-08-28T09:00:00Z"));
    const invoice: InvoiceState = {
      id: "invoice-1",
      status: "sent",
      invoice_type: "final",
      due_date: due,
      created_at: "2026-08-28T09:00:00Z",
      paid_at: null,
    };

    expect(isInvoiceOverdue(invoice, Date.parse("2026-09-10T09:00:00Z"))).toBe(false);
    expect(isInvoiceOverdue(invoice, Date.parse("2026-09-20T09:00:00Z"))).toBe(true);

    // The state the default exists to prevent: no terms, never chaseable.
    expect(isInvoiceOverdue({ ...invoice, due_date: null }, Date.parse("2027-01-01T00:00:00Z"))).toBe(
      false,
    );
  });
});
