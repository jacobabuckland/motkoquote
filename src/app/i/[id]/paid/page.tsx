import { createAdminClient } from "@/lib/supabase/admin";
import { Card } from "@/components/ui/card";
import { MadeWithMotko } from "@/components/ui/made-with-motko";
import { formatDate, formatGBP } from "@/lib/format";
import { describeSupply } from "@/lib/invoice-supply";
import { invoicePartOfJob } from "@/lib/invoice-part-of-job";
import type { LineItem } from "@/lib/schemas/job";
import { VatInvoiceDetails } from "../vat-invoice-details";
import { PendingStatus } from "./pending-status";

// Public payment receipt. Reached on-rails as the Stripe return_url after a
// pay-by-bank authorisation, and also the page the trade lands on for an invoice
// they marked paid off-rails.
//
// It must never claim payment it cannot see. Stripe redirects here as soon as
// the customer returns from their bank — before the payment_intent.succeeded
// webhook has settled anything, and whether or not they actually completed the
// authorisation. So the receipt is gated on the invoice's own settled record:
// only a genuinely paid invoice gets "Payment received". Anything else gets a
// pending state that leaves the invoice payable. This page is a public
// capability URL, so an unconditional receipt would also hand one to anyone
// holding the link.

type ReceiptContractor = {
  company_name: string | null;
  company_number: string | null;
  vat_number: string | null;
  business_profile: { registered_address?: string | null } | null;
  branding: { logo_url: string | null } | null;
};

type InvoiceWithContractor = {
  id: string;
  amount: number | null;
  status: string | null;
  paid_at: string | null;
  payment_method: string | null;
  invoice_type: string | null;
  due_date: string | null;
  created_at: string | null;
  vat_amount: number | null;
  vat_rate: number | null;
  // `job` is the QUOTE row — the alias predates this file and is left alone
  // rather than renamed, since every reference below reads it. `quoteJob` is
  // the actual job, and the contractor hangs off THAT.
  //
  // It used to read `job:quote_id(contractor:contractor_id(…))`, and `quotes`
  // has no `contractor_id` column — the table is id, job_id, line_items_json,
  // total, pdf_url, status and timestamps. PostgREST rejected the whole select,
  // so `data` came back null, `settled` was false, and EVERY paid invoice
  // rendered the pending shell server-side. Measured 14 Sep: the raw HTML of
  // all six settled invoices across four jobs contained "Payment pending", and
  // "Payment received" only ever appeared when the client-side poller happened
  // to resolve while someone was looking.
  //
  // The customer-facing cost of that is the reason it is the first thing fixed:
  // a customer who has just paid was told the payment was pending and that "if
  // you didn't finish paying, the invoice is still open", which invites a
  // second payment.
  job: {
    // The whole job, so a part-invoice can say what it is a part of.
    total: number | null;
    vat_amount: number | null;
    invoices: { amount: number; vat_amount: number | null; created_at: string }[] | null;
    line_items_json: LineItem[] | null;
    quoteJob: {
      extracted_json: { job_type?: string } | null;
      customer: { name: string; contact: { address?: string } | null } | null;
      contractor: ReceiptContractor | null;
    } | null;
    /** Only ever populated by tests/acceptance/149.test.tsx — see below. */
    contractor?: ReceiptContractor | null;
  } | null;
} | null;

export default async function InvoicePaidPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data } = await admin
    .from("invoices")
    .select(
      "id, amount, status, paid_at, payment_method, invoice_type, due_date, created_at, vat_amount, vat_rate, job:quotes(total, vat_amount, invoices(amount, vat_amount, created_at), line_items_json, quoteJob:jobs(extracted_json, customer:customers(name, contact), contractor:contractors(company_name, company_number, vat_number, business_profile, branding)))",
    )
    .eq("id", id)
    .maybeSingle();

  const invoice = data as InvoiceWithContractor;

  const amount = invoice?.amount ?? null;
  const paidAt = invoice?.paid_at ?? null;
  const quoteJob = invoice?.job?.quoteJob ?? null;
  // Read from the job first, and from the quote as a fallback.
  //
  // The select above only ever returns the first of those — `contractors` hangs
  // off `jobs`, not off `quotes`. The fallback exists because
  // tests/acceptance/149.test.tsx froze a fixture shaped to the OLD, invalid
  // select (`job:quote_id(contractor:contractor_id(…))`), so the branding it
  // pins arrives under `job.contractor`. That file is frozen and this item's
  // card does not name it for retirement, so per AGENTS.md the implementation
  // widens to satisfy it rather than the contract being edited. It costs one
  // `??` and asserts nothing untrue.
  const contractor: ReceiptContractor | null =
    quoteJob?.contractor ?? invoice?.job?.contractor ?? null;
  const companyName = contractor?.company_name ?? null;
  const logoUrl = contractor?.branding?.logo_url ?? null;
  // Settlement is webhook-driven, so the redirect can land here first. Only the
  // invoice's own record is evidence that money moved — never the mere fact that
  // Stripe sent the customer back.
  //
  // Either field is sufficient proof: settlePaidJob writes status and paid_at in
  // the same UPDATE, so they cannot disagree on anything it settled. Accepting
  // both also keeps any older row that carries only one of them rendering as the
  // receipt it is, rather than regressing to "pending".
  const settled = invoice?.status === "paid" || invoice?.paid_at != null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      {/* Logo or monogram */}
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={companyName ?? ""}
          role="img"
          className="h-12 w-12 rounded-md object-contain"
        />
      ) : companyName ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary-light text-xl font-semibold text-primary">
          {companyName.charAt(0).toUpperCase()}
        </div>
      ) : null}

      {settled ? (
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Payment received</h1>

          {/* Amount and payee line */}
          {amount !== null && (
            <p className="text-sm text-text-secondary">
              You paid {formatGBP(amount)}
              {companyName ? ` to ${companyName}` : ""}
            </p>
          )}

          {/* Payment date */}
          {paidAt && (
            <p className="text-sm text-text-secondary">{formatDate(paidAt)}</p>
          )}
        </div>
      ) : null}

      {/* THE DOCUMENT, ON THE PAGE THAT MATTERS MOST FOR IT.
          A customer who has paid needs the invoice more than one who hasn't —
          it is the record they and their accountant file. This page was a
          thank-you note: an amount, a payee and a date, with no VAT breakdown,
          no VAT number, no invoice number and nothing saying what was supplied.
          Same component and same recorded facts as /i/[id], so the receipt and
          the demand cannot disagree. */}
      {settled && invoice && invoice.created_at && invoice.amount !== null && contractor?.company_name && (
        <div className="w-full max-w-md text-left">
          <Card className="p-5">
            <VatInvoiceDetails
              facts={{
                invoiceId: invoice.id,
                issuedAt: invoice.created_at,
                dueDate: invoice.due_date,
                amount: invoice.amount,
                vatAmount: invoice.vat_amount,
                vatRate: invoice.vat_rate,
                supplier: {
                  companyName: contractor.company_name,
                  address: contractor.business_profile?.registered_address,
                  companyNumber: contractor.company_number,
                  vatNumber: contractor.vat_number,
                },
                customerName: quoteJob?.customer?.name,
                siteAddress: quoteJob?.customer?.contact?.address,
                supply: describeSupply({
                  invoiceType: invoice.invoice_type ?? "final",
                  lineItems: invoice.job?.line_items_json ?? [],
                  jobType: quoteJob?.extracted_json?.job_type,
                }),
                // The receipt is the same document, kept after payment, and is
                // the copy a bookkeeper files. See invoicePartOfJob.
                partOfJob: invoicePartOfJob({
                  quote: {
                    total: invoice.job?.total ?? 0,
                    vat_amount: invoice.job?.vat_amount ?? null,
                  },
                  earlierInvoices: (invoice.job?.invoices ?? []).filter(
                    (sibling) => sibling.created_at < (invoice.created_at ?? ""),
                  ),
                }),
              }}
            />
          </Card>
        </div>
      )}

      {!settled && (
        // Only this branch is interactive. It polls the invoice's own state and
        // resolves in place — to a receipt, to an explicit failure, or to an
        // honest "still waiting" — rather than leaving the customer on a static
        // page that would confirm their payment if only they thought to reload.
        <PendingStatus invoiceId={id} companyName={companyName} />
      )}

      <MadeWithMotko />
    </main>
  );
}
