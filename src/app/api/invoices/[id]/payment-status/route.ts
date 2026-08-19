import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Payment state for one invoice, for the customer's return page to poll.
//
// This is a PUBLIC capability URL, reached by the same bare invoice id the pay
// page and receipt already use — so it returns the smallest thing that answers
// the question and nothing else. No customer name, no contractor identity, no
// bank details, no Stripe ids, no error internals: just enough to decide which
// of three sentences to show someone who has just come back from their bank.
//
// It reports state; it never changes any. Settlement stays webhook driven.

type InvoiceRow = {
  amount: number | null;
  status: string | null;
  paid_at: string | null;
  payment_status: string | null;
};

export type PaymentState = "paid" | "processing" | "failed" | "unknown";

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const admin = createAdminClient();

  const { data } = await admin
    .from("invoices")
    .select("amount, status, paid_at, payment_status")
    .eq("id", id)
    .maybeSingle();

  const invoice = data as InvoiceRow | null;
  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Settled is decided exactly as the receipt page decides it — status OR
  // paid_at — so the poll can never disagree with the page it is driving.
  // Checked FIRST: a stale 'processing' left on a row that has since settled
  // must not outrank the settlement.
  const settled = invoice.status === "paid" || invoice.paid_at != null;

  const state: PaymentState = settled
    ? "paid"
    : invoice.payment_status === "failed"
      ? "failed"
      : invoice.payment_status === "processing"
        ? "processing"
        : "unknown";

  return NextResponse.json(
    {
      state,
      amount: invoice.amount,
      paidAt: invoice.paid_at,
    },
    // A poller must never be served a cached answer: the whole point is that
    // the value changes underneath it.
    { headers: { "Cache-Control": "no-store" } },
  );
};
