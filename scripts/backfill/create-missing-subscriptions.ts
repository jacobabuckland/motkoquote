#!/usr/bin/env tsx

/**
 * SUB-1 backfill: give existing contractors the subscription setup never created.
 *
 * WHY THIS EXISTS. `createSubscriptionForContractor` is called from exactly one
 * place — `persistContractorSetup`. SUB-1 shipped on 6 Sep; every contractor in
 * production completed setup before it. The only trigger had already fired for
 * all of them before the code existed, there is no other entry point, and
 * `subscription_projection` is empty across the whole database as a result.
 * Nobody is subscribed and nothing in the product can change that.
 *
 * WHAT IT DOES NOT DO. It charges nobody. The subscription is created with
 * SUB-1's open-ended trial (1 Jan 2100), and only `endTrialIfAllowanceExhausted`
 * ever ends it — on the third completed job, per D18. A trade who runs out of
 * free jobs starts paying then, exactly as a trade who signs up today would.
 *
 * IT DOES NOT WRITE THE PROJECTION either, deliberately. Stripe's
 * `customer.subscription.created` webhook does, from Stripe's own state, which
 * is what keeps the projection honest. So after a successful `--confirm` the
 * rows appear via the webhook, NOT immediately. If they never appear, the
 * webhook is the next thing to look at — this script has done its part.
 *
 * SAFE TO RE-RUN. `createSubscriptionForContractor` checks for a projection row
 * first and returns `already-subscribed`, and its Stripe calls are keyed on the
 * contractor id, so a retry inside Stripe's 24-hour window returns the original
 * objects rather than creating a second customer or a second subscription.
 *
 * A deliberate two-step, matching delete-voice-note-objects.ts:
 *   - Bare invocation lists who WOULD get one, and writes nothing.
 *   - `--confirm` creates them.
 *
 * RUNNABLE: npx tsx scripts/backfill/create-missing-subscriptions.ts --confirm
 *
 * Usage:
 *   npx tsx scripts/backfill/create-missing-subscriptions.ts            # list only
 *   npx tsx scripts/backfill/create-missing-subscriptions.ts --confirm  # create
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { createSubscriptionForContractor } from "../../src/lib/subscription";

type ContractorRow = {
  id: string;
  company_name: string | null;
  owner_user_id: string | null;
};

/**
 * Who needs a subscription: setup is complete (there is a company name to bill
 * under) and no projection row exists.
 *
 * Exported and pure over its inputs so the selection can be tested without
 * Stripe or a database — the rule is the part worth pinning, not the plumbing.
 */
export const contractorsMissingSubscription = (
  contractors: ContractorRow[],
  subscribedContractorIds: string[],
): ContractorRow[] => {
  const subscribed = new Set(subscribedContractorIds);
  return contractors.filter(
    (c) => Boolean(c.company_name?.trim()) && Boolean(c.owner_user_id) && !subscribed.has(c.id),
  );
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Refusing to run.`);
    process.exit(1);
  }
  return value;
};

const main = async () => {
  const confirm = process.argv.includes("--confirm");

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = requireEnv("STRIPE_SECRET_KEY");
  // Named separately because its ABSENCE is the silent failure that let setup
  // complete while creating no subscription at all — see persistContractorSetup,
  // where the whole block is behind `if (subscriptionPriceId)`.
  const priceId = requireEnv("STRIPE_SUBSCRIPTION_PRICE_ID");

  const admin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const stripe = new Stripe(stripeKey);

  const { data: contractorRows, error: contractorError } = await admin
    .from("contractors")
    .select("id, company_name, owner_user_id");
  if (contractorError) {
    console.error(`Failed to read contractors: ${contractorError.message}`);
    process.exit(1);
  }

  const { data: projectionRows, error: projectionError } = await admin
    .from("subscription_projection")
    .select("contractor_id");
  if (projectionError) {
    console.error(`Failed to read subscription_projection: ${projectionError.message}`);
    process.exit(1);
  }

  const missing = contractorsMissingSubscription(
    (contractorRows ?? []) as ContractorRow[],
    ((projectionRows ?? []) as { contractor_id: string }[]).map((r) => r.contractor_id),
  );

  if (missing.length === 0) {
    console.log("Every contractor with completed setup already has a subscription. Nothing to do.");
    process.exit(0);
  }

  console.log(
    `${missing.length} contractor${missing.length === 1 ? "" : "s"} with completed setup and no subscription:`,
  );
  for (const c of missing) {
    console.log(`  ${c.id}  ${c.company_name}`);
  }

  if (!confirm) {
    console.log("\nDry run — nothing was created. Re-run with --confirm to create them.");
    process.exit(0);
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const contractor of missing) {
    // The Stripe customer's email is the ACCOUNT email, which is what setup
    // uses (auth.getUser). business_profile.business_email is a different
    // thing — where the trade wants customer mail — and billing must not
    // silently go somewhere else.
    const { data: userResult, error: userError } = await admin.auth.admin.getUserById(
      contractor.owner_user_id as string,
    );
    const email = userResult?.user?.email;
    if (userError || !email) {
      console.error(`  ${contractor.id}: no account email (${userError?.message ?? "not found"}) — skipped`);
      failed += 1;
      continue;
    }

    try {
      const result = await createSubscriptionForContractor(admin, stripe, {
        contractorId: contractor.id,
        email,
        companyName: contractor.company_name ?? "",
        priceId,
      });
      if (result.created) {
        created += 1;
        console.log(`  ${contractor.id}: created ${result.subscriptionId}`);
      } else {
        skipped += 1;
        console.log(`  ${contractor.id}: ${result.reason} (${result.subscriptionId})`);
      }
    } catch (error) {
      failed += 1;
      console.error(
        `  ${contractor.id}: FAILED — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(`\nCreated ${created}, already had one ${skipped}, failed ${failed}.`);
  if (created > 0) {
    console.log(
      "subscription_projection rows appear via the customer.subscription.created webhook, " +
        "not from this script. If they do not turn up, check the webhook.",
    );
  }
  process.exit(failed > 0 ? 1 : 0);
};

// Only when RUN, never when imported.
//
// `contractorsMissingSubscription` above is exported so the selection rule can
// be tested without Stripe or a database. Without this guard that import also
// executes main(), which reads the environment and calls process.exit — so the
// test that exists to check the rule instead kills the test runner. Caught by
// exactly that: "process.exit unexpectedly called with 1", on the first run.
const invokedDirectly = process.argv[1]?.includes("create-missing-subscriptions") ?? false;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
