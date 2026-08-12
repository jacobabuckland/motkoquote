import { createAdminClient } from "@/lib/supabase/admin";
import { MadeWithMotko } from "@/components/ui/made-with-motko";
import { formatDate, formatGBP } from "@/lib/format";

// Public payment receipt. Reached on-rails after a TrueLayer pay-in, and also
// the page the trade lands on for an invoice they marked paid off-rails. We read
// the invoice's recorded method + date so the receipt tells the truth: an
// on-rails pay-in promises a confirmation; an off-rails one just states how and
// when it was settled (no customer confirmation is sent for those).

type InvoiceWithContractor = {
  amount: number | null;
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
      "amount, paid_at, payment_method, job:quote_id(contractor:contractor_id(company_name, branding))",
    )
    .eq("id", id)
    .maybeSingle();

  const invoice = data as InvoiceWithContractor;

  const amount = invoice?.amount ?? null;
  const paidAt = invoice?.paid_at ?? null;
  const companyName = invoice?.job?.contractor?.company_name ?? null;
  const logoUrl = invoice?.job?.contractor?.branding?.logo_url ?? null;

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

      <MadeWithMotko />
    </main>
  );
}
