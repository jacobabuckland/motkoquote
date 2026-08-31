import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getStripeClient,
  stripeKeyMode,
  stripeKeyModesConflict,
} from "@/lib/stripe-client";
import {
  createStripePayment,
  PAY_BY_BANK_LIMIT_PENNIES,
} from "@/lib/stripe-payments";
import { canAcceptStripePayment } from "@/lib/stripe-connect";
import { computeQuoteTotals } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";

type InvoiceRow = {
  id: string;
  amount: number;
  status: string;
  quote: {
    total: number;
    line_items_json: LineItem[] | null;
    job: {
      id: string;
      contractor: {
        id: string;
        stripe_account_id: string | null;
        stripe_payouts_enabled: boolean;
        free_jobs_remaining: number | null;
      } | null;
    } | null;
  } | null;
};

// Every misconfiguration returns the same opaque 503 to the caller — a customer
// must never be shown our environment's state. The cause therefore has to reach
// the server log, or the only way to tell three very different problems apart is
// to guess. Logs the SHAPE of the configuration (present or not, which mode),
// never any part of a key's value.
const configError = (reason: string): NextResponse => {
  console.error(
    "Stripe not configured — %s. secret=%s/%s publishable=%s/%s",
    reason,
    process.env.STRIPE_SECRET_KEY ? "set" : "MISSING",
    stripeKeyMode(process.env.STRIPE_SECRET_KEY ?? ""),
    resolvePublishableKey() ? "set" : "MISSING",
    stripeKeyMode(resolvePublishableKey() ?? ""),
  );
  return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
};

// The browser is handed this key in our JSON response — it never reads it from
// its own bundle — so it does NOT need the NEXT_PUBLIC_ prefix, and is better
// off without it. NEXT_PUBLIC_ values are inlined at build time, which makes
// them silently empty at runtime whenever the value was not readable during the
// build (a platform's "sensitive"/encrypted variable being the usual cause).
// Prefer the plain runtime-read variable; fall back so existing deployments
// configured the old way keep working.
const resolvePublishableKey = (): string | undefined =>
  process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

export const POST = async (request: NextRequest) => {
  // Fail fast on an unconfigured environment rather than surfacing it as a
  // failed payment. The client itself is built inside createStripePayment.
  try {
    getStripeClient();
  } catch {
    return configError("STRIPE_SECRET_KEY is unset or empty");
  }

  const publishableKey = resolvePublishableKey();
  if (!publishableKey) {
    return configError(
      "neither STRIPE_PUBLISHABLE_KEY nor NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY resolved to a value at runtime",
    );
  }

  // Refuse to mint an intent the browser provably cannot confirm. A secret key
  // in one mode and a publishable key in the other creates the PaymentIntent
  // successfully, then fails at confirm with a bare
  // "No such payment_intent: pi_…" 404 in front of the customer. Fail here
  // instead, where the cause is named in the server log.
  if (stripeKeyModesConflict(process.env.STRIPE_SECRET_KEY ?? "", publishableKey)) {
    return configError("secret and publishable keys are in different Stripe modes");
  }

  let invoiceId: string | undefined;
  try {
    const json = (await request.json()) as { invoiceId?: string };
    invoiceId = json.invoiceId;
  } catch {
    // fall through to missing-id check
  }
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("invoices")
    .select(
      "id, amount, status, quote:quotes(total, line_items_json, job:jobs(id, contractor:contractors(id, stripe_account_id, stripe_payouts_enabled, free_jobs_remaining)))",
    )
    .eq("id", invoiceId)
    .maybeSingle();

  const invoice = data as unknown as InvoiceRow | null;
  const job = invoice?.quote?.job;
  const contractor = job?.contractor;
  if (!invoice || !job || !contractor) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (invoice.status !== "sent") {
    return NextResponse.json({ error: "Invoice is not payable" }, { status: 409 });
  }

  if (!canAcceptStripePayment(contractor)) {
    return NextResponse.json(
      { error: "Contractor has not completed payout setup" },
      { status: 409 },
    );
  }

  const amountPennies = Math.round(invoice.amount * 100);
  if (amountPennies > PAY_BY_BANK_LIMIT_PENNIES) {
    return NextResponse.json(
      { error: "Amount exceeds Pay by Bank limit", code: "AMOUNT_TOO_HIGH" },
      { status: 422 },
    );
  }

  // The customer is charged the gross `amountPennies` above; the motko fee
  // rates the NET of what is being taken. This invoice may be a deposit or a
  // part payment, so the gross is converted pro-rata by the quote's OWN VAT
  // ratio (subtotal / total) rather than by an assumed rate — domestic reverse
  // charge means gross equals net on much subcontract work, and reduced-rate
  // and zero-rated work exist, so dividing by 1.2 would silently mis-charge.
  // For an unregistered contractor subtotal equals total and this is a no-op.
  const lineItems = invoice.quote?.line_items_json ?? null;
  if (!lineItems || lineItems.length === 0) {
    return NextResponse.json(
      { error: "Quote has no line items, so the net value is unknown" },
      { status: 409 },
    );
  }
  const quoteSubtotal = computeQuoteTotals(lineItems, false).subtotal;
  const quoteTotal = invoice.quote?.total ?? 0;
  const netRatio = quoteTotal > 0 ? quoteSubtotal / quoteTotal : 1;
  const netValuePennies = Math.round(amountPennies * netRatio);

  try {
    const { paymentIntent } = await createStripePayment({
      invoiceId: invoice.id,
      jobId: job.id,
      contractorId: contractor.id,
      jobValuePennies: netValuePennies,
      connectedAccountId: contractor.stripe_account_id,
      freeJobsRemaining: contractor.free_jobs_remaining ?? 0,
    });

    await admin
      .from("invoices")
      .update({ truelayer_payment_id: paymentIntent.id })
      .eq("id", invoice.id);

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      publishableKey,
    });
  } catch (err) {
    console.error("Failed to create Payment Intent:", err);
    return NextResponse.json(
      { error: "Couldn't start the payment. Please try again." },
      { status: 502 },
    );
  }
};
