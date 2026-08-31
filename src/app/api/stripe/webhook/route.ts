import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe-client";
import { settlePaidJob } from "@/lib/settle-paid-job";
import { estimateStripeProcessingFeePennies } from "@/lib/motko-fee";
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
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 500 },
    );
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
  // ── "Deposited": money leaving Stripe for the contractor's bank (PAY-8 half two) ──
  //
  // The OTHER money state. "Paid" means the customer paid and is untouched by
  // this; "deposited" means the money has been sent on. Both halves of "marked
  // as paid but no monies was received" were true, and only one of them had a
  // surface.
  //
  // These are CONNECT events: Stripe puts the connected account id on the
  // envelope (`event.account`), not in the payout body. The platform's own
  // payouts arrive on this same endpoint with no `event.account` at all — motko
  // paying itself its fee income — and must never be recorded as a contractor's.
  if (event.type === "payout.paid" || event.type === "payout.failed") {
    const payout = event.data.object as Stripe.Payout;
    const connectedAccountId = event.account;

    if (!connectedAccountId) {
      // The platform's own payout. Not a contractor's money.
      return NextResponse.json({ received: true });
    }

    const { data: contractor } = await admin
      .from("contractors")
      .select("id")
      .eq("stripe_account_id", connectedAccountId)
      .maybeSingle();

    if (!contractor) {
      // A connected account we do not know about. Ignored rather than errored:
      // returning non-2xx makes Stripe retry forever for an account that will
      // never resolve.
      console.warn("[stripe/webhook] payout for unknown account", {
        account: connectedAccountId,
        payout: payout.id,
      });
      return NextResponse.json({ received: true });
    }

    const failed = event.type === "payout.failed";

    // arrival_date is Stripe's ESTIMATE, in seconds. It is what keeps the word
    // "deposited" honest: paid means sent, not landed, and BACS can take another
    // working day.
    const arrivalDate = payout.arrival_date
      ? new Date(payout.arrival_date * 1000).toISOString()
      : null;

    // upsert on the payout id, not insert: Stripe retries delivery, and a
    // duplicate row would double-count money on the one screen whose entire job
    // is telling a trade what they received.
    const { error } = await admin.from("contractor_payouts").upsert(
      {
        contractor_id: contractor.id,
        stripe_payout_id: payout.id,
        amount_pennies: payout.amount,
        currency: payout.currency,
        status: failed ? "failed" : "paid",
        arrival_date: arrivalDate,
        failure_message: failed
          ? (payout.failure_message ?? payout.failure_code ?? "Payout failed")
          : null,
      },
      { onConflict: "stripe_payout_id" },
    );

    if (error) {
      // 500 so Stripe retries. Losing a payout record silently is how a trade
      // ends up back where they started, told nothing about their money.
      console.error("[stripe/webhook] failed to record payout", error);
      return NextResponse.json(
        { error: "Failed to record payout" },
        { status: 500 },
      );
    }

    console.log(failed ? "Payout failed" : "Payout paid", {
      payout_id: payout.id,
      contractor_id: contractor.id,
      amount: payout.amount,
    });

    return NextResponse.json({ received: true });
  }

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

    // FEE-7: Expand the PaymentIntent to retrieve balance_transaction.fee
    let expandedPaymentIntent: Stripe.PaymentIntent;
    try {
      expandedPaymentIntent = await stripe.paymentIntents.retrieve(paymentIntent.id, {
        expand: ["latest_charge.balance_transaction"],
      });
    } catch (err) {
      console.error("Failed to expand PaymentIntent for balance_transaction", {
        payment_intent_id: paymentIntent.id,
        error: err,
      });
      // Fall back to the unexpanded PaymentIntent — proceed with estimated fee only
      expandedPaymentIntent = paymentIntent;
    }

    // FEE-7: Retrieve actual processing fee from balance_transaction
    const charge = expandedPaymentIntent.latest_charge as Stripe.Charge | null;
    const balanceTransaction = charge?.balance_transaction as Stripe.BalanceTransaction | null;
    const actualFeePennies = balanceTransaction?.fee ?? null;

    if (actualFeePennies === null) {
      console.warn("balance_transaction.fee missing for PaymentIntent", {
        payment_intent_id: paymentIntent.id,
        invoice_id: invoiceId,
      });
    }

    // FEE-7: Calculate estimated processing fee
    const estimatedFeePennies = estimateStripeProcessingFeePennies(paymentIntent.amount);

    // FEE-7: Calculate delta (actual - estimated)
    const deltaPennies =
      actualFeePennies !== null ? actualFeePennies - estimatedFeePennies : null;

    await settlePaidJob(admin, {
      invoiceId,
      source: "stripe_webhook",
      paymentMethod: "stripe_bank",
      paymentProviderRef: paymentIntent.id,
      // Stripe's own record of what it took, not an assumption that every
      // pay-in carried a fee: a free job carries none, and neither does a
      // payment too small for the fee to fit inside.
      feeCollectedAtSource: (paymentIntent.application_fee_amount ?? 0) > 0,
      // FEE-7: Pass processing fee fields to settlement
      processingFeeEstimatedPennies: estimatedFeePennies,
      processingFeeActualPennies: actualFeePennies,
      processingFeeDeltaPennies: deltaPennies,
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
      console.error(
        "payment_intent.processing missing invoice_id in metadata",
        {
          payment_intent_id: paymentIntent.id,
        },
      );
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
      console.error(
        "payment_intent.payment_failed missing invoice_id in metadata",
        {
          payment_intent_id: paymentIntent.id,
        },
      );
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
