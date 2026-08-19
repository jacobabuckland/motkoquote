import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe-client";
import { settlePaidJob } from "@/lib/settle-paid-job";
import type Stripe from "stripe";

// Single Stripe webhook endpoint for both halves of the migration:
// `account.updated` carries Connect onboarding state (PAY-2), and the
// `payment_intent.*` events carry customer pay-ins (PAY-3). They share one
// route because Stripe delivers every event for the account to the same
// endpoint — splitting them would mean two secrets and two registrations.
// Signature verification is mandatory and happens once, before any branch.

export const POST = async (request: NextRequest) => {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  let stripe;
  try {
    stripe = getStripeClient();
  } catch {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── Connect onboarding state (PAY-2) ──
  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const accountId = account.id;

    const { data: contractor } = await admin
      .from("contractors")
      .select("id")
      .eq("stripe_account_id", accountId)
      .single();

    if (!contractor) {
      // Not a contractor account, or the webhook beat our own write of the
      // account ID. Ack it either way so Stripe stops retrying.
      return NextResponse.json({ received: true });
    }

    const chargesEnabled = account.capabilities?.card_payments === "active";
    const payoutsEnabled = account.capabilities?.transfers === "active";
    const requirementsDue =
      account.requirements?.currently_due &&
      account.requirements.currently_due.length > 0;

    const { error } = await admin
      .from("contractors")
      .update({
        stripe_charges_enabled: chargesEnabled,
        stripe_payouts_enabled: payoutsEnabled,
        stripe_requirements_due: requirementsDue || false,
      })
      .eq("stripe_account_id", accountId);

    if (error) {
      // Logged, not surfaced: a non-200 here only earns a Stripe retry of an
      // event we have already consumed.
      console.error("Failed to update contractor Stripe status:", error);
    }

    return NextResponse.json({ received: true });
  }

  // ── Customer pay-ins (PAY-3) ──
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const invoiceId = paymentIntent.metadata.invoice_id;

    if (!invoiceId) {
      console.error("payment_intent.succeeded missing invoice_id in metadata", {
        payment_intent_id: paymentIntent.id,
      });
      return NextResponse.json({ received: true });
    }

    console.log("Payment succeeded", {
      payment_intent_id: paymentIntent.id,
      invoice_id: invoiceId,
    });

    await settlePaidJob(admin, {
      invoiceId,
      source: "stripe_webhook",
      paymentMethod: "stripe_bank",
      paymentProviderRef: paymentIntent.id,
      // Stripe's own record of what it took, not an assumption that every
      // pay-in carried a fee: a free job carries none, and neither does a
      // payment too small for the fee to fit inside.
      feeCollectedAtSource: (paymentIntent.application_fee_amount ?? 0) > 0,
    });

    return NextResponse.json({ received: true });
  }

  // The two intermediate outcomes. Both used to console.log and return, which
  // left the customer's return page with nothing to resolve against — it could
  // only ever ask "is it paid yet?" and had no way to distinguish a slow
  // settlement from an outright failure. A signal that must change what the
  // customer is told cannot terminate in telemetry.
  //
  // Both write payment_status only, never invoices.status: settlement stays
  // webhook driven through settlePaidJob, and an intermediate value in the
  // pipeline column would be read as progress by code that has no concept of
  // one. Both are also no-ops once the invoice is paid, so a late or
  // out-of-order 'processing' cannot regress a settled invoice.
  if (event.type === "payment_intent.processing") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const invoiceId = paymentIntent.metadata.invoice_id;

    if (!invoiceId) {
      console.error("payment_intent.processing missing invoice_id in metadata", {
        payment_intent_id: paymentIntent.id,
      });
      return NextResponse.json({ received: true });
    }

    await admin
      .from("invoices")
      .update({ payment_status: "processing" })
      .eq("id", invoiceId)
      .neq("status", "paid");

    return NextResponse.json({ received: true });
  }

  if (event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const invoiceId = paymentIntent.metadata.invoice_id;

    if (!invoiceId) {
      console.error("payment_intent.payment_failed missing invoice_id in metadata", {
        payment_intent_id: paymentIntent.id,
      });
      return NextResponse.json({ received: true });
    }

    // Message and code only. The full PaymentIntent carries customer
    // payment-method detail, and this is stored to word a message, not to
    // mirror Stripe's state.
    const error = paymentIntent.last_payment_error;

    await admin
      .from("invoices")
      .update({
        payment_status: "failed",
        last_payment_error: error
          ? { message: error.message ?? null, code: error.code ?? null }
          : null,
      })
      .eq("id", invoiceId)
      .neq("status", "paid");

    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
};
