import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTrueLayerPayment } from "@/lib/truelayer-payments";
import { buildHostedPaymentPageUrl, getTrueLayerConfig } from "@/lib/truelayer";

// Creates a pay-by-bank payment for an invoice and returns the Hosted Payment
// Page URL the customer authorises on. Called at pay-page LOAD (not invoice-send
// time): TrueLayer payments expire ~15 min after creation if authorisation
// hasn't started, so we mint one as late as possible. The invoice id is an
// unguessable UUID from the customer's link — no session; we load with the
// service role and only ever pay the trade's own registered account.
type InvoiceRow = {
  id: string;
  amount: number;
  status: string;
  quote: {
    job: {
      id: string;
      contractor: {
        id: string;
        company_name: string;
        payout_details_complete: boolean;
        payout_account_holder_name: string | null;
        payout_sort_code: string | null;
        payout_account_number: string | null;
      } | null;
      customer: { name: string; contact: { email?: string } | null } | null;
    } | null;
  } | null;
};

// TrueLayer beneficiary references allow up to 18 chars; keep it alphanumeric.
const sanitizeReference = (input: string): string =>
  input.replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 18) || "MOTKO";

export const POST = async (request: NextRequest) => {
  const config = getTrueLayerConfig();
  if (!config) {
    return NextResponse.json({ error: "TrueLayer not configured" }, { status: 503 });
  }

  let invoiceId: string | undefined;
  try {
    const json = (await request.json()) as { invoiceId?: string };
    invoiceId = json.invoiceId;
  } catch {
    // fall through to the missing-id check
  }
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("invoices")
    .select(
      "id, amount, status, quote:quotes(job:jobs(id, contractor:contractors(id, company_name, payout_details_complete, payout_account_holder_name, payout_sort_code, payout_account_number), customer:customers(name, contact)))",
    )
    .eq("id", invoiceId)
    .maybeSingle();

  const invoice = data as unknown as InvoiceRow | null;
  const job = invoice?.quote?.job;
  const contractor = job?.contractor;
  const customer = job?.customer;
  if (!invoice || !job || !contractor) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (invoice.status === "paid") {
    return NextResponse.json({ error: "Already paid" }, { status: 409 });
  }

  const holderName = contractor.payout_account_holder_name;
  const sortCode = contractor.payout_sort_code;
  const accountNumber = contractor.payout_account_number;
  if (!contractor.payout_details_complete || !holderName || !sortCode || !accountNumber) {
    return NextResponse.json(
      { error: "Trade has not completed payout setup" },
      { status: 409 },
    );
  }

  const returnUri = `${process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin}/i/${invoice.id}/paid`;

  const payment = await createTrueLayerPayment({
    amountInMinor: Math.round(invoice.amount * 100),
    beneficiary: {
      accountHolderName: holderName,
      sortCode,
      accountNumber,
      reference: sanitizeReference(contractor.company_name),
    },
    payer: {
      name: customer?.name ?? "Customer",
      ...(customer?.contact?.email ? { email: customer.contact.email } : {}),
    },
    metadata: {
      invoice_id: invoice.id,
      job_id: job.id,
      contractor_id: contractor.id,
    },
  });

  await admin
    .from("invoices")
    .update({ truelayer_payment_id: payment.id })
    .eq("id", invoice.id);

  const hostedPageUrl = buildHostedPaymentPageUrl(
    config.env,
    { id: payment.id, resourceToken: payment.resourceToken },
    returnUri,
  );

  return NextResponse.json({ paymentId: payment.id, hostedPageUrl });
};
