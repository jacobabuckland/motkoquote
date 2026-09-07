// Referral credit consumption — atomically claim one unconsumed month.
//
// Every fifth referral activation banks a subscription month credit (REF-3).
// This module provides the consumption path: when a Stripe subscription invoice
// is being paid, claim one unconsumed credit to apply against that invoice.
//
// The claim is conditional (consumed = false) and atomic (limit 1), so two
// concurrent attempts against the same credit result in exactly one succeeding.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ReferralCredit = {
  id: string;
  contractor_id: string;
  consumed: boolean;
  created_at: string;
};

/**
 * Atomically claim one unconsumed referral month credit for the given contractor.
 *
 * Performs a conditional update: finds the first unconsumed credit, marks it
 * consumed, and returns it. Returns null when no unconsumed credit exists.
 *
 * @param client - Supabase client (typically service-role for server-side usage)
 * @param contractorId - The contractor whose credit to claim
 * @returns The claimed credit record, or null if none available
 */
export async function claimReferralCredit(
  client: SupabaseClient,
  contractorId: string
): Promise<ReferralCredit | null> {
  const { data, error } = await client
    .from("referral_credits")
    .update({ consumed: true })
    .eq("contractor_id", contractorId)
    .eq("consumed", false)
    .limit(1)
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}
