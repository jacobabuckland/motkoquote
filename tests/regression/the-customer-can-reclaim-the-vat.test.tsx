/**
 * @vitest-environment happy-dom
 */
// D9 and D12, as a person perceives them.
//
// D9  A VAT-registered limited company's invoice for £3,620.28 showed the
//     customer a business name, an amount, a due date and a pay button. There
//     was no VAT breakdown, no VAT number, no supplier address, no invoice
//     number and nothing saying what the work was, so neither the customer nor
//     their accountant could reclaim anything against it.
//
// D12 A settled job page carried ZERO links containing /i/. The invoices a
//     trade had raised became unreachable the moment they were paid.
//
// Both are asserted through the rendered output rather than the source, so a
// correct refactor of either component leaves these passing.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VatInvoiceDetails, type VatInvoiceFacts } from "@/app/i/[id]/vat-invoice-details";
import { InvoicesSection, type JobInvoice } from "@/app/jobs/[id]/invoices-section";

afterEach(cleanup);

const SUPPLY_LINES = [
  "Reskim hallway ceiling — 12 m2",
  "Bonding and multi-finish",
  "Waste removal",
];

/** The reported invoice: £3,016.90 net, £603.38 VAT, £3,620.28 gross. */
const REGISTERED: VatInvoiceFacts = {
  invoiceId: "f03c725f-1111-4222-8333-444444444444",
  issuedAt: "2026-09-14T09:00:00.000Z",
  dueDate: "2026-09-21",
  amount: 3620.28,
  vatAmount: 603.38,
  vatRate: 0.2,
  supplier: {
    companyName: "ABC Plastering Ltd",
    address: "12 Trade Street\nNorwich NR1 1AA",
    companyNumber: "12345678",
    vatNumber: "GB123456789",
  },
  customerName: "Harriet Vane",
  siteAddress: "7 Unthank Road, Norwich NR2 2PA",
  supply: { heading: "For", lines: SUPPLY_LINES },
};

describe("D9 — the invoice is a VAT invoice", () => {
  it("shows the net, the VAT and the rate", () => {
    render(<VatInvoiceDetails facts={REGISTERED} />);

    expect(screen.getByText("£3,016.90")).toBeDefined();
    expect(screen.getByText("£603.38")).toBeDefined();
    expect(screen.getByText("VAT (20%)")).toBeDefined();
    expect(screen.getByText("£3,620.28")).toBeDefined();
  });

  it("names itself a VAT invoice, which is what makes it reclaimable", () => {
    render(<VatInvoiceDetails facts={REGISTERED} />);
    expect(screen.getByText("VAT invoice")).toBeDefined();
  });

  it("carries the supplier's VAT number, address and company number", () => {
    render(<VatInvoiceDetails facts={REGISTERED} />);

    expect(screen.getByText("VAT number GB123456789")).toBeDefined();
    expect(screen.getByText(/12 Trade Street/)).toBeDefined();
    expect(screen.getByText("Company number 12345678")).toBeDefined();
  });

  it("carries an invoice number and the dates", () => {
    render(<VatInvoiceDetails facts={REGISTERED} />);

    expect(screen.getByText("Invoice number")).toBeDefined();
    expect(screen.getByText("F03C725F")).toBeDefined();
    expect(screen.getByText("Invoice date")).toBeDefined();
    expect(screen.getByText("Payment due")).toBeDefined();
  });

  it("says who it is to and what it is for", () => {
    render(<VatInvoiceDetails facts={REGISTERED} />);

    expect(screen.getByText("Harriet Vane")).toBeDefined();
    expect(screen.getByText(/7 Unthank Road/)).toBeDefined();
  });

  it("ITEMISES the supply rather than naming the trade", () => {
    // The first pass at D9 put `jobs.extracted_json.job_type` under "For" — a
    // category, "Plastering", not a description of what was supplied. An
    // accountant handed a £3,620.28 invoice reading "For: Plastering" bounces
    // it: a VAT invoice must identify the services and their extent.
    render(<VatInvoiceDetails facts={REGISTERED} />);

    expect(screen.getByText("Reskim hallway ceiling — 12 m2")).toBeDefined();
    expect(screen.getByText("Bonding and multi-finish")).toBeDefined();
    expect(screen.getByText("Waste removal")).toBeDefined();
  });

  it("prices NONE of the lines, because a deposit is not their sum", () => {
    // A £905.07 deposit against £3,620.28 of work. Pricing the lines here puts
    // arithmetic on the page that does not reach the figure below it. The
    // amount is stated once, in the totals block, and the heading says what it
    // is against.
    render(
      <VatInvoiceDetails
        facts={{
          ...REGISTERED,
          amount: 905.07,
          vatAmount: 150.85,
          supply: { heading: "Deposit against", lines: SUPPLY_LINES },
        }}
      />,
    );

    expect(screen.getByText("Deposit against")).toBeDefined();
    expect(screen.getByText("Reskim hallway ceiling — 12 m2")).toBeDefined();
    // No line price anywhere: the only money on the page is the invoice's own.
    expect(screen.queryByText("£3,016.90")).toBeNull();
    expect(screen.getByText("£905.07")).toBeDefined();
  });

  it("is NOT a VAT invoice when no VAT was charged, even with a VAT number", () => {
    // Reported 14 Sep on a £222 deposit. The trade was registered by the time
    // the invoice was read, so the first version of this gated on "columns
    // recorded AND supplier has a VAT number" and produced a document headed
    // "VAT invoice", citing GB123456789, stating "VAT (20%) £0.00" on a supply
    // that carried none. That asserts a taxable supply that did not happen.
    render(
      <VatInvoiceDetails
        facts={{
          ...REGISTERED,
          amount: 222,
          vatAmount: 0,
          vatRate: 0.2,
          supplier: { ...REGISTERED.supplier, vatNumber: "GB123456789" },
        }}
      />,
    );

    expect(screen.queryByText("VAT invoice")).toBeNull();
    expect(screen.getByText("Invoice")).toBeDefined();
    expect(screen.queryByText(/VAT number/)).toBeNull();
    expect(screen.queryByText(/^VAT \(/)).toBeNull();
    expect(screen.getByText("£222.00")).toBeDefined();
  });

  it("shows NO VAT block for an unregistered trade", () => {
    // Owen's job: £740, no VAT ever charged, no VAT number. A VAT line here
    // would claim a registration that does not exist — the same defect as the
    // "VAT (20%) £0.00" row on his quote.
    render(
      <VatInvoiceDetails
        facts={{
          ...REGISTERED,
          amount: 740,
          vatAmount: 0,
          vatRate: 0.2,
          supplier: { companyName: "Owen Pryce Plastering", vatNumber: null },
        }}
      />,
    );

    expect(screen.queryByText(/VAT number/)).toBeNull();
    expect(screen.queryByText(/^VAT \(/)).toBeNull();
    expect(screen.getByText("Invoice")).toBeDefined();
    expect(screen.getByText("£740.00")).toBeDefined();
  });

  it("omits the breakdown on an invoice raised before VAT was recorded", () => {
    // Unknown is not zero. Computing the split from today's registration is
    // exactly what migration 80 exists to stop.
    render(
      <VatInvoiceDetails
        facts={{ ...REGISTERED, vatAmount: null, vatRate: null }}
      />,
    );

    expect(screen.queryByText(/^VAT \(/)).toBeNull();
    expect(screen.getByText("Total")).toBeDefined();
    expect(screen.getByText("£3,620.28")).toBeDefined();
  });
});

const invoice = (over: Partial<JobInvoice>): JobInvoice => ({
  id: "d725ba3c-1111-4222-8333-444444444444",
  amount: 905.07,
  status: "paid",
  invoice_type: "deposit",
  due_date: "2026-09-21",
  created_at: "2026-09-10T09:00:00.000Z",
  paid_at: "2026-09-12T09:00:00.000Z",
  ...over,
});

describe("D12 — a settled job can reach its own invoices", () => {
  const props = { appUrl: "https://motko.app", customerFirstName: "Harriet" };

  it("links to every invoice, paid ones included", () => {
    render(
      <InvoicesSection
        {...props}
        invoices={[
          invoice({}),
          invoice({
            id: "8ec1d341-1111-4222-8333-444444444444",
            amount: 2715.21,
            invoice_type: "final",
            created_at: "2026-09-13T09:00:00.000Z",
          }),
        ]}
      />,
    );

    const links = screen.getAllByRole("link", { name: "View invoice" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/\/i\//);
    }
  });

  it("shows what each one was for and what it came to", () => {
    render(<InvoicesSection {...props} invoices={[invoice({})]} />);

    expect(screen.getByText("Deposit · £905.07")).toBeDefined();
    expect(screen.getByText(/^Paid /)).toBeDefined();
  });

  it("lists them oldest first, so a deposit precedes its balance", () => {
    render(
      <InvoicesSection
        {...props}
        invoices={[
          invoice({
            id: "8ec1d341-1111-4222-8333-444444444444",
            amount: 2715.21,
            invoice_type: "final",
            created_at: "2026-09-13T09:00:00.000Z",
          }),
          invoice({}),
        ]}
      />,
    );

    const text = screen.getByRole("heading", { name: "Invoices" }).parentElement?.textContent ?? "";
    expect(text.indexOf("Deposit")).toBeLessThan(text.indexOf("Final"));
  });

  it("shows an outstanding invoice's due date rather than claiming it is paid", () => {
    render(
      <InvoicesSection
        {...props}
        invoices={[invoice({ status: "sent", paid_at: null })]}
      />,
    );

    expect(screen.getByText(/^Due /)).toBeDefined();
    expect(screen.queryByText(/^Paid /)).toBeNull();
  });

  it("renders nothing at all on a job that has raised none", () => {
    const { container } = render(<InvoicesSection {...props} invoices={[]} />);
    expect(container.textContent).toBe("");
  });
});
