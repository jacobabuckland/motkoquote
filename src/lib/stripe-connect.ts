// Stripe Connect account creation and management for contractor onboarding.
//
// Contractors onboard via Stripe-hosted Account Links (Express accounts).
// We persist only the connected account ID and capability flags; all bank
// details and KYC live in Stripe.

import { stripe } from "./stripe";
import { createAdminClient } from "./supabase/admin";

// Contractor record shape for onboarding status checks.
//
// READ THIS BEFORE CHANGING ANYTHING THAT USES THESE THREE BOOLEANS. Two wrong
// calls were made on one day (2026-08-25) by reasoning about them from their
// names rather than from what fills them, and one would have shut the pay
// button for every contractor.
//
//   stripe_payouts_enabled  — MISNAMED. Holds `capabilities.transfers`, i.e.
//                             "this account may RECEIVE transfers into its
//                             Stripe balance". It does NOT mean Stripe will pay
//                             that balance out to a bank; the real
//                             `account.payouts_enabled` is not stored anywhere.
//                             This is what canAcceptStripePayment gates on, and
//                             it is the correct thing to gate on.
//   stripe_charges_enabled  — holds `capabilities.card_payments`, which
//                             createConnectedAccount deliberately NEVER
//                             requests. It is therefore false for every
//                             contractor and always will be. Gating anything on
//                             it is the mistake referred to above.
//   stripe_requirements_due — honest: Stripe wants more information.
//
// The name was left as it is deliberately (owner decision, 2026-08-25).
// Renaming the column would break frozen acceptance contracts in
// tests/acceptance/216.test.tsx and bank-details-rail-gating.test.tsx, and it
// would move no money and change no behaviour. Documenting it here was judged
// the better trade than a migration plus two broken contracts.
type ContractorStripeStatus = {
  /** `capabilities.transfers` — may receive transfers. NOT "pays out to bank". */
  stripe_payouts_enabled: boolean;
  stripe_account_id: string | null;
  /** `capabilities.card_payments`, never requested — false for everyone. */
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
          interval: "daily",
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
  // Note which capability fills which column: `payoutsEnabled` is read from
  // TRANSFERS, not from account.payouts_enabled. The variable name matches the
  // column, and the column is misnamed — see ContractorStripeStatus above. Kept
  // rather than corrected because tests/acceptance/344.test.ts asserts on this
  // identifier, and because renaming half of a misnaming is worse than either.
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
 * @returns true once the account may receive transfers.
 *
 * Reads stripe_payouts_enabled, which holds the `transfers` capability — see
 * the note on ContractorStripeStatus. "Onboarding complete" here means Stripe
 * has verified them enough to receive money, NOT that money reaches their bank.
 * Whether a payout has actually landed is a separate state that does not exist
 * yet (Roadmap PAY-8 builds the payout leg).
 */
export function isOnboardingComplete(
  contractor: ContractorStripeStatus,
): boolean {
  return contractor.stripe_payouts_enabled === true;
}

/**
 * Whether a contractor can take a Stripe payment right now — the single gate
 * for both the customer-facing pay button and the Payment Intent route.
 *
 * Gates on the `transfers` capability (stored as stripe_payouts_enabled), NOT
 * on stripe_charges_enabled. These are destination charges: the platform is the
 * merchant of record, so the connected account only ever needs `transfers` —
 * which is the one capability createConnectedAccount requests. stripe_charges_
 * enabled is derived from `card_payments`, which is deliberately never
 * requested, so it is false for every contractor and always will be. Gating on
 * it held the pay button shut for everyone regardless of onboarding state.
 *
 * Narrows stripe_account_id to non-null on the true branch, so a caller that has
 * passed the gate can use it as a charge destination without re-checking.
 */
export function canAcceptStripePayment<
  T extends {
    stripe_account_id: string | null;
    stripe_payouts_enabled: boolean;
  },
>(contractor: T): contractor is T & { stripe_account_id: string } {
  return (
    Boolean(contractor.stripe_account_id) && contractor.stripe_payouts_enabled
  );
}
