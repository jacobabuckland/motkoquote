import { createAdminClient } from "@/lib/supabase/admin";
import { MadeWithMotko } from "@/components/ui/made-with-motko";
import { formatDate, formatGBP } from "@/lib/format";
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

type InvoiceWithContractor = {
  amount: number | null;
  status: string | null;
  paid_at: string | null;
  payment_method: string | null;
  job: {
    contractor: {
      company_name: string | null;
      branding: {
        logo_url: string | null;
      } | null;
    } | null;
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
      "amount, status, paid_at, payment_method, job:quote_id(contractor:contractor_id(company_name, branding))",
    )
    .eq("id", id)
    .maybeSingle();

  const invoice = data as InvoiceWithContractor;

  const amount = invoice?.amount ?? null;
  const paidAt = invoice?.paid_at ?? null;
  const companyName = invoice?.job?.contractor?.company_name ?? null;
  const logoUrl = invoice?.job?.contractor?.branding?.logo_url ?? null;
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
      ) : (
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
