import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card } from "@/components/ui/card";
import { MadeWithMotko } from "@/components/ui/made-with-motko";
import { formatGBP, formatDate } from "@/lib/format";
import { PayButton } from "./pay-button";

// Customer-facing pay-by-bank page. Public (invoice UUID from the trade's link,
// no session) — loaded with the service role. The payment itself is minted at
// button-press via /api/truelayer/create-payment (TrueLayer payments expire
// ~15 min from creation, so we don't create one just to render the page).
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
        payout_details_complete: boolean;
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
      "id, amount, status, invoice_type, due_date, quote:quotes(job:jobs(customer:customers(name), contractor:contractors(company_name, payout_details_complete, branding)))",
    )
    .eq("id", id)
    .maybeSingle();

  const invoice = data as unknown as InvoiceWithRelations | null;
  const job = invoice?.quote?.job;
  const contractor = job?.contractor;
  if (!invoice || !contractor) notFound();

  if (invoice.status === "paid") redirect(`/i/${id}/paid`);

  const brandColor = contractor.branding?.brand_color ?? "#004225";
  const logoUrl = contractor.branding?.logo_url;
  const label = invoiceTypeLabel[invoice.invoice_type] ?? "Invoice";

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- contractor-uploaded logo from Supabase storage
            <img src={logoUrl} alt="" className="h-12 w-12 rounded-md object-contain" />
          )}
          <div>
            <h1 className="mb-1 text-2xl font-semibold" style={{ color: brandColor }}>
              {contractor.company_name}
            </h1>
            <p className="text-sm text-text-secondary">
              {label} for {job?.customer?.name ?? "you"}
            </p>
          </div>
        </div>

        <Card className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-text-secondary">Amount due</span>
            <span className="text-3xl font-semibold tabular-nums">
              {formatGBP(invoice.amount)}
            </span>
          </div>
          {invoice.due_date && (
            <p className="text-sm text-text-secondary">
              Due {formatDate(invoice.due_date)}
            </p>
          )}

          {contractor.payout_details_complete ? (
            <>
              <PayButton invoiceId={invoice.id} />
              <p className="text-center text-xs text-text-muted">
                You&apos;ll be taken to your bank to approve the payment securely.
                The money goes straight to {contractor.company_name}.
              </p>
            </>
          ) : (
            <p className="rounded-card border border-warning bg-warning-bg p-3 text-sm text-warning">
              {contractor.company_name} hasn&apos;t finished setting up payments
              yet. Please get in touch with them to pay.
            </p>
          )}
        </Card>

        <MadeWithMotko />
      </div>
    </main>
  );
}
