/**
 * Update all connected Stripe accounts to use daily automatic payouts.
 *
 * Stripe payouts were set to "manual" at account creation, but no code existed
 * to trigger payouts. Money accumulated in contractor balances and never reached
 * their banks. This script updates every existing connected account's payout
 * schedule to daily.
 *
 * RUNNABLE: npx tsx scripts/update-payout-schedules.ts
 *
 * Requires: STRIPE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL in the environment.
 *
 * Idempotent: safe to run multiple times. Stripe accepts schedule updates even
 * when the schedule is already set correctly.
 */

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// Validate required environment variables
const stripeKey = process.env.STRIPE_SECRET_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!stripeKey) {
  console.error("Error: STRIPE_SECRET_KEY environment variable is required");
  process.exit(2);
}

if (!supabaseUrl) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL environment variable is required");
  process.exit(2);
}

// Initialize clients
const stripe = new Stripe(stripeKey, {
  apiVersion: "2026-07-29.dahlia",
});

const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || "", {
  auth: { persistSession: false },
});

async function main() {
  console.log("Starting payout schedule update for all connected accounts...");

  // Query all contractors with a Stripe account ID (where stripe_account_id is not null)
  const { data: contractors, error } = await supabase
    .from("contractors")
    .select("id, stripe_account_id")
    .not("stripe_account_id", "is", null);

  if (error) {
    throw new Error(`Failed to query contractors: ${error.message}`);
  }

  if (!contractors || contractors.length === 0) {
    console.log("No contractors with Stripe accounts found.");
    return;
  }

  console.log(`Found ${contractors.length} contractors with Stripe accounts.`);

  let updated = 0;
  let failed = 0;

  // Update each account's payout schedule
  for (const contractor of contractors) {
    const accountId = contractor.stripe_account_id;
    if (!accountId) continue;

    try {
      // Update payouts schedule to daily interval
      await stripe.accounts.update(accountId, {
        settings: {
          payouts: {
            schedule: { interval: "daily" },
          },
        },
      });
      updated++;
      console.log(`✓ Updated ${accountId}`);
    } catch (err) {
      failed++;
      console.error(`✗ Failed to update ${accountId}:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Total accounts processed: ${contractors.length}`);
  console.log(`Successfully updated: ${updated}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
