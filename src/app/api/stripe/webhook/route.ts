import { NextResponse, type NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type Stripe from "stripe";

// Stripe webhook handler for account.updated events.
// Updates contractor capability flags when connected accounts complete onboarding
// or when requirements become due. Signature verification is mandatory.

export const POST = async (request: NextRequest) => {
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 503 },
    );
  }

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    );
  }

  // Handle account.updated events
  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const accountId = account.id;

    const supabase = createAdminClient();

    // Find contractor by Stripe account ID
    const { data: contractor } = await supabase
      .from("contractors")
      .select("id")
      .eq("stripe_account_id", accountId)
      .single();

    if (!contractor) {
      // Account not found in our database - likely not a contractor account
      // or webhook fired before we persisted the ID. Return 200 to ack receipt.
      return NextResponse.json({ received: true });
    }

    // Map Stripe capability status to database flags
    const chargesEnabled = account.capabilities?.card_payments === "active";
    const payoutsEnabled = account.capabilities?.transfers === "active";
    const requirementsDue =
      account.requirements?.currently_due &&
      account.requirements.currently_due.length > 0;

    // Update capability flags
    const { error } = await supabase
      .from("contractors")
      .update({
        stripe_charges_enabled: chargesEnabled,
        stripe_payouts_enabled: payoutsEnabled,
        stripe_requirements_due: requirementsDue || false,
      })
      .eq("stripe_account_id", accountId);

    if (error) {
      // Log error but still return 200 to Stripe to avoid retries
      console.error("Failed to update contractor Stripe status:", error);
    }
  }

  return NextResponse.json({ received: true });
};
