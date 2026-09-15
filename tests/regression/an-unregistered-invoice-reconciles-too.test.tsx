/**
 * @vitest-environment happy-dom
 */
// PASS-7 SERIOUS 3: the non-VAT final invoice did not reconcile for the
// customer.
//
// The VAT-registered balance invoice spells it out:
//
//     Job total (net)        £2,100.00
//     Less already invoiced   −£630.00
//     Net now due            £1,470.00
//     VAT (20%)                £294.00
//     Total                  £1,764.00
//
// The unregistered equivalent, for a £910 job with £227.50 already paid, read
// in full:
//
//     Total                    £682.50
//
// No job total, no credit for the deposit, nothing accounting for the
// difference. The customer cannot check the bill and their bookkeeper cannot
// post it.
//
// The cause: the "Job total / Less already invoiced" rows were nested inside
// the `showVatBreakdown` branch. Whether an invoice is part of a larger job
// has nothing to do with whether VAT was charged on it.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VatInvoiceDetails } from "@/app/i/[id]/vat-invoice-details";

afterEach(cleanup);

// The reported job, to the penny: £910 total, £227.50 deposit already raised,
// £682.50 balance now due, no VAT anywhere.
const UNREGISTERED_BALANCE = {
  invoiceId: "4edccb4b-0000-4000-8000-000000000001",
  issuedAt: "2026-09-15T09:00:00.000Z",
  dueDate: "2026-09-22",
  amount: 682.5,
  vatAmount: null,
  vatRate: null,
  supplier: {
    companyName: "Delta Plastering",
    address: null,
    companyNumber: null,
    vatNumber: null,
  },
  customerName: "QA Pass7 Delta",
  siteAddress: null,
  supply: null,
  partOfJob: { jobNet: 910, alreadyInvoicedNet: 227.5 },
} as const;

// The same job for a VAT-registered trade, to prove the fix did not disturb it.
const REGISTERED_BALANCE = {
  ...UNREGISTERED_BALANCE,
  amount: 1764,
  vatAmount: 294,
  vatRate: 0.2,
  supplier: { ...UNREGISTERED_BALANCE.supplier, vatNumber: "GB123456789" },
  partOfJob: { jobNet: 2100, alreadyInvoicedNet: 630 },
} as const;

const rows = (): string =>
  (document.body.textContent ?? "").replace(/\s+/g, " ");

describe("an unregistered trade's balance invoice", () => {
  it("states the job total it is part of", () => {
    render(<VatInvoiceDetails facts={UNREGISTERED_BALANCE} />);

    expect(screen.getByText("Job total")).toBeDefined();
    expect(rows()).toContain("£910.00");
  });

  it("credits what was already invoiced, as a deduction", () => {
    render(<VatInvoiceDetails facts={UNREGISTERED_BALANCE} />);

    expect(screen.getByText("Less already invoiced")).toBeDefined();
    // The minus sign is the whole meaning of the row. £227.50 printed as a
    // positive on a bill is a second charge, not a credit.
    expect(rows()).toContain("−£227.50");
  });

  it("still ends on the amount actually due", () => {
    render(<VatInvoiceDetails facts={UNREGISTERED_BALANCE} />);

    expect(screen.getByText("Total")).toBeDefined();
    expect(rows()).toContain("£682.50");
  });

  it("adds up: job total less already invoiced IS the total", () => {
    // The claim the document is making, checked rather than assumed. This is
    // what the customer could not do before.
    const { jobNet, alreadyInvoicedNet } = UNREGISTERED_BALANCE.partOfJob;
    expect(jobNet - alreadyInvoicedNet).toBe(UNREGISTERED_BALANCE.amount);
  });

  it("names no VAT and no net/gross distinction, because there is none", () => {
    render(<VatInvoiceDetails facts={UNREGISTERED_BALANCE} />);

    const text = rows();
    expect(text).not.toMatch(/VAT \(/);
    // "(net)" on a document with no VAT distinguishes nothing.
    expect(text).not.toContain("Job total (net)");
    expect(text).not.toContain("Net now due");
  });
});

describe("a single invoice that is the whole job is unchanged", () => {
  it("shows a bare total, with nothing to reconcile against", () => {
    render(<VatInvoiceDetails facts={{ ...UNREGISTERED_BALANCE, partOfJob: null }} />);

    const text = rows();
    expect(text).not.toContain("Job total");
    expect(text).not.toContain("Less already invoiced");
    expect(text).toContain("£682.50");
  });
});

describe("the VAT-registered document is untouched", () => {
  it("keeps the full five-row breakdown", () => {
    render(<VatInvoiceDetails facts={REGISTERED_BALANCE} />);

    const text = rows();
    expect(text).toContain("Job total (net)");
    expect(text).toContain("£2,100.00");
    expect(text).toContain("−£630.00");
    expect(text).toContain("Net now due");
    expect(text).toContain("£1,470.00");
    expect(text).toMatch(/VAT \(20%\)/);
    expect(text).toContain("£294.00");
    expect(text).toContain("£1,764.00");
  });

  it("adds up the same way, through VAT", () => {
    const { jobNet, alreadyInvoicedNet } = REGISTERED_BALANCE.partOfJob;
    const netNowDue = jobNet - alreadyInvoicedNet;
    expect(netNowDue).toBe(1470);
    expect(netNowDue + (REGISTERED_BALANCE.vatAmount ?? 0)).toBe(REGISTERED_BALANCE.amount);
  });
});
