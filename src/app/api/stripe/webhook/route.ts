import type Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getStripeClient } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";
import { formatGBP } from "@/lib/format";
import { logError } from "@/lib/errors";
import { trackEvent } from "@/lib/track";

type PaidInvoiceRow = {
  amount: number;
  invoice_type: string;
  quote: { job: { id: string; customer: { name: string } | null } | null } | null;
};

export const POST = async (request: NextRequest) => {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    await logError("stripe_webhook", error, { context: { stage: "signature" } });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const admin = createAdminClient();
    const invoiceId = session.metadata?.invoice_id;

    const invoiceSelect =
      "amount, invoice_type, quote:quotes(job:jobs(id, customer:customers(name)))";
    const update = admin
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() });

    let paid: PaidInvoiceRow | null = null;
    if (invoiceId) {
      const { data } = await update.eq("id", invoiceId).select(invoiceSelect).maybeSingle();
      paid = data as unknown as PaidInvoiceRow | null;
    } else if (session.payment_link) {
      const paymentLinkId =
        typeof session.payment_link === "string" ? session.payment_link : session.payment_link.id;
      const { data } = await update
        .eq("stripe_payment_link_id", paymentLinkId)
        .select(invoiceSelect)
        .maybeSingle();
      paid = data as unknown as PaidInvoiceRow | null;
    }

    if (paid) {
      await trackEvent("invoice_paid", {
        invoice_id: invoiceId ?? null,
        invoice_type: paid.invoice_type,
        amount: paid.amount,
      });
    }

    const job = paid?.quote?.job;
    if (job) {
      const customerName = job.customer?.name ?? "Your customer";
      const label = paid?.invoice_type === "deposit" ? "the deposit" : "your invoice";
      await notifyContractorOfCustomerAction(admin, {
        jobId: job.id,
        subject: `${customerName} paid ${label}`,
        heading: `${customerName} paid ${label} — ${formatGBP(paid?.amount ?? 0)}.`,
        nextStep:
          paid?.invoice_type === "deposit"
            ? "Next step: crack on with the work — raise the final invoice when you're done."
            : "Nothing else needed — the job's settled and paid.",
      });
    }
  }
  } catch (error) {
    // Log then rethrow so the response status is unchanged (Stripe still sees
    // a failure and retries as before). Never swallow into a 200.
    await logError("stripe_webhook", error, { context: { type: event.type } });
    throw error;
  }

  return NextResponse.json({ received: true });
};
