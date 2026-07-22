import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateReferralCode,
  isSelfReferral,
  normalizeReferralCode,
} from "@/lib/referral";

// Referral provisioning at trade signup. All writes here go through the
// service-role admin client: `credit_events` and `referrals` are RLS
// SELECT-only for owners (writes are server-side only, see migration 023).

// Assigns the trade its own shareable referral code, retrying on the (astronomically
// rare) collision against the partial unique index. The `.is("referral_code", null)`
// filter means a concurrent winner simply no-ops rather than overwriting.
const issueUniqueReferralCode = async (
  admin: SupabaseClient,
  contractorId: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateReferralCode();
    const { error } = await admin
      .from("contractors")
      .update({ referral_code: code })
      .eq("id", contractorId)
      .is("referral_code", null);
    if (!error) return;
    // A unique-violation means the code collided with another trade — retry.
  }
  throw new Error("Could not issue a unique referral code");
};

export type RedeemReferralResult = {
  redeemed: boolean;
  reason?: "invalid_code" | "unknown_code" | "self_referral" | "already_referred";
};

// Creates the pending referral linking the code's owner (referrer) to the new
// trade (referee). No credit is granted here — the reward fires on the referee's
// first paid job (settlePaidJob). Blocks self-referral both by contractor id and
// by shared owner email; the DB's unique(referee_contractor_id) is the final
// guard against a trade being referred twice.
export const redeemReferral = async (
  admin: SupabaseClient,
  params: { code: string; refereeContractorId: string; refereeEmail: string | null },
): Promise<RedeemReferralResult> => {
  const normalized = normalizeReferralCode(params.code);
  if (!normalized) return { redeemed: false, reason: "invalid_code" };

  const { data: referrer } = await admin
    .from("contractors")
    .select("id, owner_user_id")
    .eq("referral_code", normalized)
    .maybeSingle();
  if (!referrer) return { redeemed: false, reason: "unknown_code" };
  if (referrer.id === params.refereeContractorId) {
    return { redeemed: false, reason: "self_referral" };
  }

  // Shared-email self-referral (same person, two accounts). Best-effort: if the
  // lookup fails we still have the contractor-id and DB distinct-check guards.
  try {
    const { data: referrerUser } = await admin.auth.admin.getUserById(
      referrer.owner_user_id,
    );
    if (
      isSelfReferral(
        { email: referrerUser?.user?.email ?? null },
        { email: params.refereeEmail },
      )
    ) {
      return { redeemed: false, reason: "self_referral" };
    }
  } catch {
    // fall through — rely on the id + DB guards
  }

  const { error } = await admin.from("referrals").insert({
    referrer_contractor_id: referrer.id,
    referee_contractor_id: params.refereeContractorId,
    code_used: normalized,
    status: "pending",
  });
  // A unique-violation here means this trade was already referred — treat as
  // benign (the first referral stands).
  if (error) return { redeemed: false, reason: "already_referred" };
  return { redeemed: true };
};

// One-time provisioning for a newly-created trade: the +5 signup grant (the
// free_jobs_remaining cache already defaults to 5; this keeps the ledger
// invariant sum(delta)==free_jobs_remaining), redemption of any code captured at
// signup, and issuance of the trade's own shareable code. Idempotent — the
// presence of a referral_code is the "already provisioned" gate, and each step
// is independently guarded so a partial failure self-heals on retry. Issuing the
// code LAST means the gate only closes once everything above has run.
export const provisionNewContractor = async (
  admin: SupabaseClient,
  params: {
    contractorId: string;
    refereeEmail: string | null;
    signupReferralCode: string | null;
  },
): Promise<void> => {
  const { data: contractor } = await admin
    .from("contractors")
    .select("referral_code")
    .eq("id", params.contractorId)
    .single();
  if (contractor?.referral_code) return;

  const { count: grantCount } = await admin
    .from("credit_events")
    .select("id", { count: "exact", head: true })
    .eq("contractor_id", params.contractorId)
    .eq("reason", "signup_grant");
  if ((grantCount ?? 0) === 0) {
    await admin.from("credit_events").insert({
      contractor_id: params.contractorId,
      delta: 5,
      reason: "signup_grant",
    });
  }

  if (params.signupReferralCode) {
    const { count: referralCount } = await admin
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referee_contractor_id", params.contractorId);
    if ((referralCount ?? 0) === 0) {
      await redeemReferral(admin, {
        code: params.signupReferralCode,
        refereeContractorId: params.contractorId,
        refereeEmail: params.refereeEmail,
      });
    }
  }

  await issueUniqueReferralCode(admin, params.contractorId);
};
