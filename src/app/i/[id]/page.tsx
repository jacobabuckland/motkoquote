import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPubliclyUnavailable } from "@/lib/erased-artefact";
import { createClient } from "@/lib/supabase/server";
import { describeSupply } from "@/lib/invoice-supply";
import type { LineItem } from "@/lib/schemas/job";
import { BackToDashboard } from "@/components/ui/back-to-dashboard";
import { Card } from "@/components/ui/card";
import { MadeWithMotko } from "@/components/ui/made-with-motko";
import { Monogram } from "@/components/ui/monogram";
import { Money } from "@/components/ui/money";
import { formatDate } from "@/lib/format";
import { canAcceptStripePayment } from "@/lib/stripe-connect";
import { PayButton } from "./pay-button";
import { VatInvoiceDetails } from "./vat-invoice-details";
import { BankTransferDetails } from "./bank-transfer-details";
import { buildPayPanel } from "./pay-panel";
import { ReassuranceStrip } from "@/components/ui/reassurance-strip";
import { StripeSetupPrompt } from "./stripe-setup-prompt";

type InvoiceWithRelations = {
  id: string;
  amount: number;
  status: string;
  invoice_type: string;
  due_date: string | null;
  created_at: string;
  // Migration 80's split of `amount`. Null on an invoice raised before it,
  // which the document treats as "not recorded" and omits — never as zero.
  vat_amount: number | null;
  vat_rate: number | null;
  quote: {
    // The itemised supply the customer agreed to. An invoice that does not say
    // what it is for is not a document an accountant can accept.
    line_items_json: LineItem[] | null;
    job: {
      extracted_json: { job_type?: string } | null;
      customer: { name: string; contact: { address?: string } | null } | null;
      contractor: {
        company_name: string;
        company_number: string | null;
        vat_number: string | null;
        business_profile: { registered_address?: string | null } | null;
        erased_at: string | null;
        first_name: string | null;
        payout_details_complete: boolean;
        payout_account_holder_name: string | null;
        payout_sort_code: string | null;
        payout_account_number: string | null;
        stripe_account_id: string | null;
        stripe_payouts_enabled: boolean;
        stripe_pay_by_bank_enabled: boolean;
        stripe_requirements_due: boolean;
        branding: { brand_color?: string; logo_url?: string } | null;
        owner_user_id: string;
      } | null;
    } | null;
  } | null;
};

const invoiceTypeLabel: Record<string, string> = {
  deposit: "Deposit",
  final: "Invoice",
};

export default async function InvoicePayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data } = await admin
    .from("invoices")
    .select(
      "id, amount, status, invoice_type, due_date, created_at, vat_amount, vat_rate, quote:quotes(line_items_json, job:jobs(extracted_json, customer:customers(name, contact), contractor:contractors(company_name, company_number, vat_number, business_profile, first_name, payout_details_complete, payout_account_holder_name, payout_sort_code, payout_account_number, stripe_account_id, stripe_payouts_enabled, stripe_pay_by_bank_enabled, stripe_requirements_due, branding, erased_at, owner_user_id)))",
    )
    .eq("id", id)
    .maybeSingle();

  const invoice = data as unknown as InvoiceWithRelations | null;
  const job = invoice?.quote?.job;
  const contractor = job?.contractor;
  if (!invoice || !contractor) notFound();

  // An erased trade's documents stop resolving (D6 / §4.2). Checked before the
  // paid-redirect below so a voided invoice cannot bounce a customer onward to
  // a receipt page for an account that no longer exists.
  if (isPubliclyUnavailable({ erasedAt: contractor.erased_at, status: invoice.status })) {
    notFound();
  }

  if (invoice.status === "paid") redirect(`/i/${id}/paid`);

  // This route is a public capability URL (no session required). Separately
  // detect whether an authenticated contractor is previewing it, so we can give
  // them a way back to the dashboard — the customer sees nothing new.
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();

  const brandColor = contractor.branding?.brand_color ?? "#004225";
  const logoUrl = contractor.branding?.logo_url;
  const label = invoiceTypeLabel[invoice.invoice_type] ?? "Invoice";

  const stripeReady = canAcceptStripePayment(contractor);
  const isContractorViewing = user?.id === contractor.owner_user_id;
  const showStripePrompt = isContractorViewing && !stripeReady;

  const panel = buildPayPanel({
    railsAvailable: stripeReady,
    payoutDetailsComplete: contractor.payout_details_complete,
    accountHolderName: contractor.payout_account_holder_name,
    sortCode: contractor.payout_sort_code,
    accountNumber: contractor.payout_account_number,
    companyName: contractor.company_name,
    firstName: contractor.first_name,
    amount: invoice.amount,
    invoiceId: invoice.id,
    stripePayoutsEnabled: contractor.stripe_payouts_enabled,
    stripeRequirementsDue: contractor.stripe_requirements_due,
  });

  return (
    <main className="flex flex-1 justify-center px-5 py-8">
      <div className="flex w-full max-w-md flex-col gap-5">
        {user && <BackToDashboard />}

        {/* Document head. The trade's brand colour rides on the monogram —
            where getContrastingTextColor guarantees it stays legible — and the
            business name is set in ink. A customer-facing document that means
            money should read the same however the trade picked their colour;
            an arbitrary hex on a heading is what makes paperwork look amateur. */}
        <div className="flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- contractor-uploaded logo from Supabase storage
            <img
              src={logoUrl}
              alt={contractor.company_name}
              className="h-12 w-12 shrink-0 rounded-sm object-contain"
            />
          ) : (
            <Monogram
              companyName={contractor.company_name}
              brandColor={brandColor}
              size={48}
            />
          )}
          <div className="min-w-0">
            <h1 className="display truncate text-lg font-bold text-ink">
              {contractor.company_name}
            </h1>
            <p className="truncate text-sm text-ink-secondary">
              {label} for {job?.customer?.name ?? "you"}
            </p>
          </div>
        </div>

        {showStripePrompt && <StripeSetupPrompt onboardingUrl="/settings" />}

        <Card className="flex flex-col gap-5 p-5">
          {/* The money moment. Same ledger treatment as the dashboard: the
              figure is the largest thing on the screen and everything else
              stays quiet around it. */}
          <div className="border-b border-line pb-5">
            <p className="eyebrow">Amount due</p>
            <div className="animate-ledger mt-1.5">
              <Money amount={invoice.amount} size="hero" />
            </div>
            {invoice.due_date && (
              <p className="mt-1.5 text-sm text-ink-secondary">
                Due {formatDate(invoice.due_date)}
              </p>
            )}
          </div>

          {panel.mode === "setup_incomplete" ? (
            <p className="keyline-move rounded-card border border-line-strong bg-amber-tint p-3 text-sm text-ink">
              {contractor.company_name} hasn&apos;t finished setting up payments
              yet. Please get in touch with them to pay.
            </p>
          ) : panel.mode === "button_only" ? (
            <>
              {/* The rail is live, so the button is the path and no bank
                  details are produced or served. The fallback below reveals
                  them on demand ONLY after a payment attempt fails, so a
                  customer whose bank is unsupported is never stranded — but
                  nobody is handed a fee-free route they didn't need. */}
              <PayButton
                invoiceId={invoice.id}
                amount={invoice.amount}
                companyName={contractor.company_name}
              />
              <ReassuranceStrip companyName={contractor.company_name} />
            </>
          ) : (
            <>
              {/* No reassurance strip on this branch: its approved copy says
                  payments are processed by Stripe, which is not true of a
                  manual bank transfer. Restyle only — never relocate a
                  legally-signed-off string into a path it wasn't cleared for. */}
              <div className="flex flex-col gap-2">
                <p className="display text-lg font-bold">Pay by bank transfer</p>
                <BankTransferDetails {...panel.transfer} />
              </div>
              <p className="text-sm text-ink-secondary">
                Once you&apos;ve paid, {panel.guidanceName} will mark this
                invoice as paid.
              </p>
            </>
          )}
        </Card>

        {/* THE DOCUMENT ITSELF, below the pay action.
            The amount and the button stay first because paying is what the
            customer came to do — but an invoice is also a record they and their
            accountant have to be able to use, and this page carried none of it.
            Reported 14 Sep on a VAT-registered limited company's £3,620.28
            demand: no VAT breakdown, no VAT number, no supplier address, no
            invoice number, nothing describing the work. */}
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
              customerName: job?.customer?.name,
              siteAddress: job?.customer?.contact?.address,
              supply: describeSupply({
                invoiceType: invoice.invoice_type,
                lineItems: invoice.quote?.line_items_json ?? [],
                jobType: job?.extracted_json?.job_type,
              }),
            }}
          />
        </Card>

        <MadeWithMotko />
      </div>
    </main>
  );
}
