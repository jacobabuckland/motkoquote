import type Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { getStripeClient } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";
import { formatGBP } from "@/lib/format";

type PaidInvoiceRow = {
  amount: number;
  invoice_type: string;
  quote: { id: string; job: { id: string; customer: { name: string } | null } | null } | null;
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
    const admin = createAdminClient();
    const invoiceId = session.metadata?.invoice_id;

    const invoiceSelect =
      "amount, invoice_type, quote:quotes(id, job:jobs(id, customer:customers(name)))";
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

    // Product analytics — record the payment server-side with the service
    // role (there's no user session in a webhook). Fire-and-forget: never let
    // an analytics failure break webhook processing.
    if (paid?.quote) {
      try {
        let method: "card" | "pay_by_bank" = "card";
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
        if (paymentIntentId) {
          const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ["latest_charge"],
          });
          const charge = intent.latest_charge as Stripe.Charge | null;
          const type = charge?.payment_method_details?.type;
          if (type && type !== "card") method = "pay_by_bank";
        }
        await admin.from("events").insert({
          user_id: null,
          event_name: "payment_received",
          properties: { quote_id: paid.quote.id, amount: paid.amount, method },
        });
      } catch (error) {
        console.warn("[analytics] failed to track \"payment_received\"", error);
      }
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
  }

  return NextResponse.json({ received: true });
};
