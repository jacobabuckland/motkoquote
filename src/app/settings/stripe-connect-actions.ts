"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createConnectedAccount,
  createAccountLink,
  refreshAccountStatus,
  getAccountRequirements,
} from "@/lib/stripe-connect";

/**
 * Starts Stripe Connect onboarding for the current contractor.
 * Creates a connected account if needed, generates an Account Link, and redirects.
 */
export async function startStripeOnboarding(): Promise<
  { url: string } | { error: string }
> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not authenticated" };
  }

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, stripe_account_id")
    .eq("owner_user_id", user.id)
    .single();

  if (!contractor) {
    return { error: "Contractor not found" };
  }

  try {
    // Create account if needed, or reuse existing
    let stripeAccountId = contractor.stripe_account_id;
    if (!stripeAccountId) {
      stripeAccountId = await createConnectedAccount(contractor.id);
    }

    // Generate Account Link (mints fresh link for re-entry)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const returnUrl = `${appUrl}/settings`;
    const url = await createAccountLink(stripeAccountId, returnUrl);

    return { url };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Failed to start onboarding: ${message}` };
  }
}

/**
 * Refreshes Stripe account status from Stripe API.
 * Fallback when webhooks are delayed or dropped.
 */
export async function refreshStripeStatus(): Promise<
  { success: true } | { error: string }
> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not authenticated" };
  }

  const { data: contractor } = await supabase
    .from("contractors")
    .select("stripe_account_id")
    .eq("owner_user_id", user.id)
    .single();

  if (!contractor?.stripe_account_id) {
    return { error: "No Stripe account found" };
  }

  try {
    await refreshAccountStatus(contractor.stripe_account_id);
    revalidatePath("/settings");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Failed to refresh status: ${message}` };
  }
}

/**
 * Fetches specific requirements from Stripe for the current contractor's account.
 * Returns requirement field names (e.g. "individual.verification.document").
 */
export async function fetchStripeRequirements(): Promise<
  { requirements: string[] } | { error: string }
> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not authenticated" };
  }

  const { data: contractor } = await supabase
    .from("contractors")
    .select("stripe_account_id")
    .eq("owner_user_id", user.id)
    .single();

  if (!contractor?.stripe_account_id) {
    return { error: "No Stripe account found" };
  }

  const requirements = await getAccountRequirements(contractor.stripe_account_id);

  if (requirements === null) {
    return { error: "Failed to fetch requirements from Stripe" };
  }

  return { requirements };
}
