import { createAdminClient } from "@/lib/supabase/admin";
import { MadeWithMotko } from "@/components/ui/made-with-motko";
import { formatDate } from "@/lib/format";

// Public payment receipt. Reached on-rails after a TrueLayer pay-in, and also
// the page the trade lands on for an invoice they marked paid off-rails. We read
// the invoice's recorded method + date so the receipt tells the truth: an
// on-rails pay-in promises a confirmation; an off-rails one just states how and
// when it was settled (no customer confirmation is sent for those).
const methodLabel: Record<string, string> = {
  cash: "cash",
  bank_transfer: "bank transfer",
};

export default async function InvoicePaidPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("invoices")
    .select("payment_method, paid_at")
    .eq("id", id)
    .maybeSingle();

  const method = invoice?.payment_method ?? null;
  const paidOn = invoice?.paid_at ? formatDate(invoice.paid_at) : null;
  const offRails = method !== null && method !== "motko_bank";

  // Off-rails: "Paid by cash, 3 Jul 2026" (or just the date for "other").
  const subtitle = offRails
    ? methodLabel[method]
      ? `Paid by ${methodLabel[method]}${paidOn ? `, ${paidOn}` : ""}.`
      : `Paid${paidOn ? ` on ${paidOn}` : ""}.`
    : "Thanks — you'll get a confirmation shortly.";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-pill bg-primary-light text-2xl font-semibold text-primary"
      >
        ✓
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Payment received</h1>
        <p className="text-sm text-text-secondary">{subtitle}</p>
      </div>
      <MadeWithMotko />
    </main>
  );
}
