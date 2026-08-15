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
    });

    return NextResponse.json({ received: true });
  }

  if (event.type === "payment_intent.processing") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    console.log("Payment processing", {
      payment_intent_id: paymentIntent.id,
      invoice_id: paymentIntent.metadata.invoice_id,
    });
    return NextResponse.json({ received: true });
  }

  if (event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    console.log("Payment failed", {
      payment_intent_id: paymentIntent.id,
      invoice_id: paymentIntent.metadata.invoice_id,
      last_payment_error: paymentIntent.last_payment_error,
    });
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
};
