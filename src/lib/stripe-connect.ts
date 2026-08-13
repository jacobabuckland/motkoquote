// Stripe Connect account creation and management for contractor onboarding.
//
// Contractors onboard via Stripe-hosted Account Links (Express accounts).
// We persist only the connected account ID and capability flags; all bank
// details and KYC live in Stripe.

import { stripe } from "./stripe";
import { createAdminClient } from "./supabase/admin";

// Contractor record shape for onboarding status checks
type ContractorStripeStatus = {
  stripe_account_id: string | null;
  stripe_payouts_enabled: boolean;
  stripe_charges_enabled: boolean;
  stripe_requirements_due: boolean;
};

/**
 * Creates a Stripe Express connected account for a contractor.
 * Stores the account ID in contractors.stripe_account_id.
 *
 * @param contractorId - Contractor's database ID
 * @returns Stripe account ID
 */
export async function createConnectedAccount(
  contractorId: string,
): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const supabase = createAdminClient();

  // Check if account already exists
  const { data: existing } = await supabase
    .from("contractors")
    .select("stripe_account_id")
    .eq("id", contractorId)
    .single();

  if (existing?.stripe_account_id) {
    return existing.stripe_account_id;
  }

  // Create Express account with transfers capability (bank payouts only, no card payments)
  const account = await stripe.accounts.create({
    type: "express",
    capabilities: {
      transfers: { requested: true },
    },
    settings: {
      payouts: {
        schedule: {
          interval: "manual",
        },
      },
    },
  });

  // Persist account ID to database
  const { error } = await supabase
    .from("contractors")
    .update({ stripe_account_id: account.id })
    .eq("id", contractorId);

  if (error) {
    throw new Error(`Failed to save Stripe account ID: ${error.message}`);
  }

  return account.id;
}

/**
 * Generates a Stripe-hosted Account Link for onboarding or re-entry.
 * Links expire after ~5 minutes, so mint fresh links each time.
 * Returns contractor to /settings after completing onboarding.
 *
 * @param stripeAccountId - Stripe connected account ID
 * @param returnUrl - URL to redirect contractor after onboarding (typically /settings)
 * @returns Account Link URL
 */
export async function createAccountLink(
  stripeAccountId: string,
  returnUrl: string,
): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  // Create account link with return_url and refresh_url both pointing to /settings
  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: returnUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return accountLink.url;
}

/**
 * Polls Stripe API for account capability status and updates contractors table.
 * Fallback for when webhooks are delayed or dropped.
 *
 * @param stripeAccountId - Stripe connected account ID
 */
export async function refreshAccountStatus(
  stripeAccountId: string,
): Promise<void> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const account = await stripe.accounts.retrieve(stripeAccountId);

  const supabase = createAdminClient();

  // Map Stripe capability status to database boolean flags
  const chargesEnabled = account.capabilities?.card_payments === "active";
  const payoutsEnabled = account.capabilities?.transfers === "active";
  const requirementsDue =
    account.requirements?.currently_due &&
    account.requirements.currently_due.length > 0;

  const { error } = await supabase
    .from("contractors")
    .update({
      stripe_charges_enabled: chargesEnabled,
      stripe_payouts_enabled: payoutsEnabled,
      stripe_requirements_due: requirementsDue || false,
    })
    .eq("stripe_account_id", stripeAccountId);

  if (error) {
    throw new Error(`Failed to update account status: ${error.message}`);
  }
}

/**
 * Checks if contractor has completed Stripe onboarding.
 *
 * @param contractor - Contractor record with Stripe fields
 * @returns true if payouts are enabled
 */
export function isOnboardingComplete(
  contractor: ContractorStripeStatus,
): boolean {
  return contractor.stripe_payouts_enabled === true;
}
