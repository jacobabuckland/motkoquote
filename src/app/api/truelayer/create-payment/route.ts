import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTrueLayerPayment } from "@/lib/truelayer-payments";
import { buildHostedPaymentPageUrl, checkSigningKey, getTrueLayerConfig, getTrueLayerSigning } from "@/lib/truelayer";
import { logError } from "@/lib/analytics";
import { withTimeout, TIMEOUT_MS } from "@/lib/with-timeout";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRateLimitConfig } from "@/lib/rate-limit-config";
import { getClientIp } from "@/lib/get-client-ip";

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
  // Parse request body first for rate limiting
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

  // Rate limiting: per-IP and per-invoice (logical AND)
  const clientIp = getClientIp(request);
  const isServiceCaller = !!process.env.CRON_SECRET && request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  const checks = [];
  const ipConfig = getRateLimitConfig("RATE_LIMIT_CREATE_PAYMENT_PER_IP", "RATE_LIMIT_CREATE_PAYMENT_WINDOW_IP");
  if (ipConfig && clientIp) {
    checks.push({ key: `create-payment:ip:${clientIp}`, config: ipConfig });
  }

  const invoiceConfig = getRateLimitConfig("RATE_LIMIT_CREATE_PAYMENT_PER_INVOICE", "RATE_LIMIT_CREATE_PAYMENT_WINDOW_INVOICE");
  if (invoiceConfig) {
    checks.push({ key: `create-payment:invoice:${invoiceId}`, config: invoiceConfig });
  }

  if (checks.length > 0) {
    try {
      const limitResult = await checkRateLimit(checks, { skipAuth: isServiceCaller });
      if (!limitResult.allowed) {
        return NextResponse.json(
          { error: `Too many payment requests. Please try again in ${limitResult.retryAfter} seconds.` },
          {
            status: 429,
            headers: { "Retry-After": limitResult.retryAfter.toString() }
          }
        );
      }
    } catch (err) {
      // Fail open: if rate limiter throws, allow the request and log the error
      console.error("[rate-limit] Rate limiter error, failing open:", err);
    }
  }

  // Config checks after rate limiting
  const config = getTrueLayerConfig();
  // The signing pair (KID + private key) is as essential as the client creds:
  // createTrueLayerPayment throws without it. Gate on both up front so a missing
  // signing env returns a legible 503 rather than an opaque 500 mid-request.
  const signing = getTrueLayerSigning();
  if (!config || !signing) {
    return NextResponse.json({ error: "TrueLayer not configured" }, { status: 503 });
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
  // Only a live, unpaid invoice can spawn a pay-in. Guarding on the positive
  // "sent" state (rather than excluding "paid") also refuses draft, cancelled,
  // or otherwise non-payable invoices from minting a payment link.
  if (invoice.status !== "sent") {
    return NextResponse.json({ error: "Invoice is not payable" }, { status: 409 });
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

  let payment: Awaited<ReturnType<typeof createTrueLayerPayment>>;
  try {
    payment = await withTimeout(
      createTrueLayerPayment({
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
      }),
      TIMEOUT_MS.truelayer,
      "createTrueLayerPayment",
    );
  } catch (err) {
    // createTrueLayerPayment throws with the TrueLayer response body on !ok, so
    // this captures the real reason (env mismatch, rejected beneficiary, etc.)
    // in the Vercel logs while the customer sees a clean, retryable message.
    // Alongside the verbatim body we record the signing-key verdict (shape only,
    // never the key): a TrueLayer signature rejection is opaque, so knowing the
    // configured key is a valid EC P-521 immediately separates a key/KID problem
    // from wrong credentials or the live app lacking Payments V3.
    await logError("server", "create-payment failed", {
      invoice_id: invoice.id,
      detail: err instanceof Error ? err.message : String(err),
      signing_key: checkSigningKey(),
    });
    return NextResponse.json(
      { error: "Couldn't start the payment. Please try again." },
      { status: 502 },
    );
  }

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
