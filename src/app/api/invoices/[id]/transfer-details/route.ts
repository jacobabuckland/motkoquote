import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildTransferDetails, hasPayoutDetails } from "@/app/i/[id]/pay-panel";

// The trade's bank-transfer details for one invoice, fetched ON DEMAND.
//
// Under PAY-4 fee-at-source motko earns only when money moves through the
// Stripe rail, so bank details no longer ship in the invoice page's body when
// the rail is live — a sort code beside the pay button is a route around the
// fee. But a rail that is *available* can still fail at payment time: the
// customer's bank may not support Pay by Bank, the Payment Intent may error.
// Hiding the details unconditionally would leave that customer with no way to
// pay at all, which is worse than the leak.
//
// So this exists: the page requests it only after a payment attempt has failed,
// which keeps the details out of the default payload while guaranteeing there
// is always a route to paying. It is a PUBLIC capability URL, reached by the
// same bare invoice id as the pay page.
//
// It reports; it never changes state.

type InvoiceRow = {
  amount: number | null;
  status: string | null;
  quote: {
    job: {
      contractor: {
        payout_details_complete: boolean;
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
      "amount, status, quote:quotes(job:jobs(contractor:contractors(payout_details_complete, payout_account_holder_name, payout_sort_code, payout_account_number)))",
    )
    .eq("id", id)
    .maybeSingle();

  const invoice = data as unknown as InvoiceRow | null;
  const contractor = invoice?.quote?.job?.contractor;

  // Unknown invoice, and an invoice that is already settled, are the same
  // answer: nothing to pay, so nothing to serve. Indistinguishable responses,
  // so the endpoint cannot be used to probe which invoice ids exist or which
  // have been paid.
  if (!invoice || !contractor || invoice.status === "paid" || invoice.amount == null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const details = {
    payoutDetailsComplete: contractor.payout_details_complete,
    accountHolderName: contractor.payout_account_holder_name,
    sortCode: contractor.payout_sort_code,
    accountNumber: contractor.payout_account_number,
    amount: invoice.amount,
    invoiceId: id,
  };

  // Payout setup incomplete means there is no account to transfer to. Same
  // 404 — an empty or half-filled panel is worse than none.
  if (!hasPayoutDetails(details)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(buildTransferDetails(details), {
    headers: {
      "Cache-Control": "no-store",
      // These are the fields needed to target authorised push payment fraud.
      // Keep them out of the referrer chain when the page navigates onward.
      "Referrer-Policy": "no-referrer",
    },
  });
};
