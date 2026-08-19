import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatGBP, formatSortCode, invoicePaymentReference } from "@/lib/format";

// Transfer details for one invoice, fetched on demand after a payment error.
//
// This is a PUBLIC capability URL. It returns bank details (contractor's own
// account) for unpaid invoices only. Already-paid invoices return 404.
//
// The details are never in the initial invoice page load — they are fetched
// only when a genuine payment attempt fails and the customer activates the
// fallback control.

type InvoiceWithContractor = {
  amount: number;
  status: string;
  quote: {
    job: {
      contractor: {
        payout_account_holder_name: string | null;
        payout_sort_code: string | null;
        payout_account_number: string | null;
      } | null;
    } | null;
  } | null;
};

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const admin = createAdminClient();

  const { data } = await admin
    .from("invoices")
    .select(
      "amount, status, quote:quotes(job:jobs(contractor:contractors(payout_account_holder_name, payout_sort_code, payout_account_number)))",
    )
    .eq("id", id)
    .maybeSingle();

  const invoice = data as unknown as InvoiceWithContractor | null;

  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only serve transfer details for unpaid invoices
  if (invoice.status === "paid") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contractor = invoice.quote?.job?.contractor;
  if (
    !contractor?.payout_account_holder_name ||
    !contractor?.payout_sort_code ||
    !contractor?.payout_account_number
  ) {
    return NextResponse.json(
      { error: "Transfer details not available" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    accountHolderName: contractor.payout_account_holder_name,
    sortCode: formatSortCode(contractor.payout_sort_code),
    accountNumber: contractor.payout_account_number,
    amount: formatGBP(invoice.amount),
    reference: invoicePaymentReference(id),
  });
};
