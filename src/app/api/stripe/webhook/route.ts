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

// Mark the invoice behind a completed Checkout Session as paid and notify the
// contractor. Shared between the immediate-payment path (card, via
// checkout.session.completed with payment_status "paid") and the delayed path
// (Pay by Bank, via checkout.session.async_payment_succeeded once funds
// actually settle) so a bank payment triggers the same status update + email.
const settlePaidSession = async (
  session: Stripe.Checkout.Session,
  stripe: Stripe,
) => {
  const admin = createAdminClient();
  const invoiceId = session.metadata?.invoice_id;

  const invoiceSelect =
    "amount, invoice_type, quote:quotes(id, job:jobs(id, customer:customers(name)))";
  const update = admin
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() });

  // The `.neq("status", "paid")` makes settlement idempotent: a redelivered or
  // double-fired event updates zero rows and returns null, so the analytics
  // event and contractor notification below fire exactly once per payment.
  let paid: PaidInvoiceRow | null = null;
  if (invoiceId) {
    const { data } = await update
      .eq("id", invoiceId)
      .neq("status", "paid")
      .select(invoiceSelect)
      .maybeSingle();
    paid = data as unknown as PaidInvoiceRow | null;
  } else if (session.payment_link) {
    const paymentLinkId =
      typeof session.payment_link === "string" ? session.payment_link : session.payment_link.id;
    const { data } = await update
      .eq("stripe_payment_link_id", paymentLinkId)
      .neq("status", "paid")
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
};

// Stripe Connect: mirror the connected account's capability + requirements
// status onto the tradesperson's contractor row. This is the source of truth
// for whether we can create destination charges (charges_enabled) and whether
// to show the "Finish payout setup" banner (requirements.currently_due).
const syncConnectAccount = async (account: Stripe.Account) => {
  const admin = createAdminClient();
  await admin
    .from("contractors")
    .update({
      stripe_charges_enabled: account.charges_enabled,
      stripe_payouts_enabled: account.payouts_enabled,
      stripe_requirements_due: (account.requirements?.currently_due?.length ?? 0) > 0,
    })
    .eq("stripe_account_id", account.id);
};

// A refund on a destination charge (issued from the Stripe dashboard with
// "reverse transfer", which claws the funds back from the connected account)
// flips the invoice back out of "paid". We map the charge to its invoice via
// the PaymentIntent's invoice_id metadata, set when the payment link is created.
const settleRefund = async (charge: Stripe.Charge, stripe: Stripe) => {
  if (!charge.refunded) return;
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const invoiceId = intent.metadata?.invoice_id;
  if (!invoiceId) return;

  const admin = createAdminClient();
  await admin
    .from("invoices")
    .update({ status: "refunded", paid_at: null })
    .eq("id", invoiceId);
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
      await settlePaidSession(session, stripe);
    }
  } else if (event.type === "checkout.session.async_payment_succeeded") {
    // Pay by Bank funds have now cleared — settle exactly as a card payment.
    await settlePaidSession(event.data.object as Stripe.Checkout.Session, stripe);
  } else if (event.type === "account.updated") {
    // Connect onboarding progress: store charges_enabled / payouts_enabled and
    // whether Stripe still needs more info. Delivered to the platform account.
    await syncConnectAccount(event.data.object as Stripe.Account);
  } else if (event.type === "charge.refunded") {
    // Destination-charge refund (with transfer reversal) — take the invoice
    // back out of "paid".
    await settleRefund(event.data.object as Stripe.Charge, stripe);
  }
  // checkout.session.async_payment_failed / abandonment: intentionally left
  // unhandled. The invoice stays "sent" (payable) so the customer can retry —
  // we never mark it permanently failed.

  return NextResponse.json({ received: true });
};
