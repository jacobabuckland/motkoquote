import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { BackToDashboard } from "@/components/ui/back-to-dashboard";
import { Card } from "@/components/ui/card";
import { MadeWithMotko } from "@/components/ui/made-with-motko";
import { Monogram } from "@/components/ui/monogram";
import { Money } from "@/components/ui/money";
import { formatDate } from "@/lib/format";
import { canAcceptStripePayment } from "@/lib/stripe-connect";
import { PayButton } from "./pay-button";
import { BankTransferDetails } from "./bank-transfer-details";
import { buildPayPanel } from "./pay-panel";
import { ReassuranceStrip } from "@/components/ui/reassurance-strip";

type InvoiceWithRelations = {
  id: string;
  amount: number;
  status: string;
  invoice_type: string;
  due_date: string | null;
  quote: {
    job: {
      customer: { name: string } | null;
      contractor: {
        company_name: string;
        first_name: string | null;
        payout_details_complete: boolean;
        payout_account_holder_name: string | null;
        payout_sort_code: string | null;
        payout_account_number: string | null;
        stripe_account_id: string | null;
        stripe_payouts_enabled: boolean;
        branding: { brand_color?: string; logo_url?: string } | null;
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
      "id, amount, status, invoice_type, due_date, quote:quotes(job:jobs(customer:customers(name), contractor:contractors(company_name, first_name, payout_details_complete, payout_account_holder_name, payout_sort_code, payout_account_number, stripe_account_id, stripe_payouts_enabled, branding)))",
    )
    .eq("id", id)
    .maybeSingle();

  const invoice = data as unknown as InvoiceWithRelations | null;
  const job = invoice?.quote?.job;
  const contractor = job?.contractor;
  if (!invoice || !contractor) notFound();

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

        <MadeWithMotko />
      </div>
    </main>
  );
}
