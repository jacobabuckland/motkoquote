import type Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getStripeClient } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";
import { formatGBP } from "@/lib/format";

type PaidInvoiceRow = {
  amount: number;
  invoice_type: string;
  quote: { job: { id: string; customer: { name: string } | null } | null } | null;
};

// Mark the invoice behind a completed Checkout Session as paid and notify the
// contractor. Shared between the immediate-payment path (card, via
// checkout.session.completed with payment_status "paid") and the delayed path
// (Pay by Bank, via checkout.session.async_payment_succeeded once funds
// actually settle) so a bank payment triggers the same status update + email.
const settlePaidSession = async (session: Stripe.Checkout.Session) => {
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

  const job = paid?.quote?.job;
  if (job) {
    const customerName = job.customer?.name ?? "Your customer";
    const label = paid?.invoice_type === "deposit" ? "the deposit" : "your invoice";
    await notifyContractorOfCustomerAction(admin, {
      jobId: job.id,
      event: paid?.invoice_type === "deposit" ? "deposit_paid" : "final_paid",
      subject: `${customerName} paid ${label}`,
      heading: `${customerName} paid ${label} — ${formatGBP(paid?.amount ?? 0)}.`,
      nextStep:
        paid?.invoice_type === "deposit"
          ? "Next step: crack on with the work — raise the final invoice when you're done."
          : "Nothing else needed — the job's settled and paid.",
    });
  }
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
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    // Delayed-notification methods (Pay by Bank) complete the session before
    // funds settle — payment_status is "unpaid"/"processing" here, so don't
    // mark paid yet; async_payment_succeeded will follow. Immediate methods
    // (card) arrive already "paid" and settle now.
    if (session.payment_status === "paid") {
      await settlePaidSession(session);
    }
  } else if (event.type === "checkout.session.async_payment_succeeded") {
    // Pay by Bank funds have now cleared — settle exactly as a card payment.
    await settlePaidSession(event.data.object as Stripe.Checkout.Session);
  }
  // checkout.session.async_payment_failed / abandonment: intentionally left
  // unhandled. The invoice stays "sent" (payable) so the customer can retry —
  // we never mark it permanently failed.

  return NextResponse.json({ received: true });
};
