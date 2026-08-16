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

type InvoiceRow = {
  id: string;
  amount: number;
  status: string;
  quote: {
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

export const POST = async (request: NextRequest) => {
  // Fail fast on an unconfigured environment rather than surfacing it as a
  // failed payment. The client itself is built inside createStripePayment.
  try {
    getStripeClient();
  } catch {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 },
    );
  }

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 },
    );
  }

  // Refuse to mint an intent the browser provably cannot confirm. A secret key
  // in one mode and a publishable key in the other creates the PaymentIntent
  // successfully, then fails at confirm with a bare
  // "No such payment_intent: pi_…" 404 in front of the customer. Fail here
  // instead, where the cause is named in the server log.
  if (stripeKeyModesConflict(process.env.STRIPE_SECRET_KEY ?? "", publishableKey)) {
    console.error(
      "Stripe key mode mismatch: STRIPE_SECRET_KEY is %s but NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is %s. Both must be the same mode and the same account.",
      stripeKeyMode(process.env.STRIPE_SECRET_KEY ?? ""),
      stripeKeyMode(publishableKey),
    );
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 },
    );
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
      "id, amount, status, quote:quotes(job:jobs(id, contractor:contractors(id, stripe_account_id, stripe_payouts_enabled, free_jobs_remaining)))",
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

  try {
    const { paymentIntent } = await createStripePayment({
      invoiceId: invoice.id,
      jobId: job.id,
      contractorId: contractor.id,
      jobValuePennies: amountPennies,
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
