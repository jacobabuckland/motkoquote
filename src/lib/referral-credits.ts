// Banking, claiming, and play-out of referral credits — discrete months earned
// every 5th activation and consumed on cancellation.
//
// Every 5 activated referrals earn one banked month (a discrete row in
// `referral_credits`). Banking does NOT replace the existing `referral_unlock`
// free-job grant — both fire on the fifth activation.
//
// Credits are consumed on cancellation: a trade canceling with N unconsumed
// credits keeps access for N months beyond the paid period. Consumption is
// atomic — two concurrent claims against one contractor's credits must claim
// different rows.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ReferralCreditRow = {
  id: string;
  contractor_id: string;
  consumed: boolean;
  created_at: string;
};

/**
 * Computes how many banked credits are earned for a given activation count.
 * Every 5 activations earn 1 credit (no cap).
 *
 * @param activationCount - Total number of activated referrals
 * @returns The number of banked credits earned
 */
export function computeCreditsEarned(activationCount: number): number {
  return Math.floor(activationCount / 5);
}

/**
 * Claims one unconsumed credit atomically. The update is conditional on
 * `consumed = false` to prevent concurrent claims from double-spending.
 *
 * @param contractorId - The contractor claiming the credit
 * @param client - Supabase client (for testing or service-role usage)
 * @returns The claimed credit row, or null if no unconsumed credits exist
 */
export async function claimReferralCredit(
  contractorId: string,
  client: SupabaseClient
): Promise<ReferralCreditRow | null> {
  // Query for one unconsumed credit belonging to this contractor
  const { data: credits } = await client
    .from("referral_credits")
    .select("*")
    .eq("contractor_id", contractorId)
    .eq("consumed", false)
    .limit(1);

  if (!credits || credits.length === 0) {
    return null;
  }

  const credit = credits[0] as ReferralCreditRow;

  // Mark it consumed with a conditional update
  // Include both contractor_id and consumed filters for atomicity
  const { data: updated } = await client
    .from("referral_credits")
    .update({ consumed: true })
    .eq("contractor_id", contractorId)
    .eq("id", credit.id)
    .eq("consumed", false)
    .select()
    .maybeSingle();

  return (updated as ReferralCreditRow) ?? null;
}

/**
 * Computes the extended access end date when a trade cancels with banked credits.
 * Each credit extends access by one month beyond the paid period.
 *
 * @param creditCount - Number of unconsumed credits the contractor holds
 * @param paidUntil - The end of the paid subscription period
 * @returns The extended access end date (paidUntil + creditCount months)
 */
export function computeExtendedAccess(
  creditCount: number,
  paidUntil: Date
): Date {
  if (creditCount === 0) {
    return paidUntil;
  }

  const extended = new Date(paidUntil);
  extended.setMonth(extended.getMonth() + creditCount);
  return extended;
}
