import type { SupabaseClient } from "@supabase/supabase-js";
import { planReferralReward } from "@/lib/referral-reward";

/**
 * REF-4: activate a referral on the referee's FIRST SENT QUOTE.
 *
 * WHY THE TRIGGER MOVED. It used to fire on the referee's first PAID job, which
 * meant the referrer's reward depended on that trade finding a customer, having
 * a quote accepted, and being paid through motko — weeks away, and mostly
 * outside anyone's control. Sending a quote is the first act that shows the
 * trade actually adopted motko, and it happens on day one. Jacob accepted the
 * looser abuse profile explicitly on 10 Sep, and ruled anti-abuse work out of
 * scope for this change.
 *
 * THE PAID PATH IS LEFT ALONE, deliberately. `settle-paid-job.ts` looks up a
 * referral still `pending`, so once a quote has activated one there is nothing
 * left for it to find and it cannot grant twice. It stays as a safety net for
 * any referral that somehow reaches payment without a quote ever being sent
 * through motko, and leaving it also keeps `planPaidJobSettlement` — which eight
 * frozen acceptance files cover — completely untouched.
 *
 * BEST EFFORT, and it must stay that way: a trade sending a quote to their
 * customer must never see it fail because a referral reward could not be
 * written. Every error here is logged and swallowed by the caller.
 *
 * SERVICE ROLE REQUIRED. This writes to the REFERRER's rows — their free-job
 * balance and activation count — which the sending trade's own session has no
 * business touching, and which RLS correctly forbids.
 */

/** Postgres unique_violation. The referral was already credited. */
const UNIQUE_VIOLATION = "23505";

export type ReferralActivationResult =
  | { activated: false; reason: "no-pending-referral" | "referrer-missing" | "already-credited" }
  | { activated: true; referralId: string; grantedFreeJobs: number; bankedCredit: boolean };

export const activateReferralOnFirstQuote = async (
  admin: SupabaseClient,
  input: { refereeContractorId: string; jobId: string },
): Promise<ReferralActivationResult> => {
  // A still-pending referral in which this trade is the referee.
  const { data: referral } = await admin
    .from("referrals")
    .select("id, referrer_contractor_id")
    .eq("referee_contractor_id", input.refereeContractorId)
    .eq("status", "pending")
    .maybeSingle();

  if (!referral) return { activated: false, reason: "no-pending-referral" };

  const row = referral as { id: string; referrer_contractor_id: string };

  // Incremented BEFORE planning so the tier is computed against the
  // post-increment value — the 5th activation sees 5 and grants 5. Atomic
  // UPDATE ... RETURNING, so two concurrent activations cannot read the same
  // count and both grant the early-tier amount.
  const { data: counted, error: countError } = await admin.rpc(
    "increment_activated_referral_count",
    { contractor_id: row.referrer_contractor_id },
  );

  if (countError) throw countError;
  if (!counted || counted.length === 0) {
    return { activated: false, reason: "referrer-missing" };
  }

  const activatedReferralCount = (counted as { activated_referral_count: number }[])[0]
    .activated_referral_count;

  // The referrer's balance, so the FEE-11 cap can actually bind.
  //
  // No caller supplied this before REF-4 — `settle-paid-job.ts` still does not —
  // so the cap of 10 that Jacob confirmed on 1 Sep has been inert on the paid
  // path since it shipped, and every referral there granted in full. Passing it
  // here is what makes the recorded decision effective on the trigger that is
  // now live.
  const { data: referrer } = await admin
    .from("contractors")
    .select("free_jobs_remaining")
    .eq("id", row.referrer_contractor_id)
    .maybeSingle();

  const reward = planReferralReward({
    activatedReferralCount,
    referrerFreeJobsRemaining:
      (referrer as { free_jobs_remaining: number | null } | null)?.free_jobs_remaining ?? undefined,
  });

  if (reward.grantedFreeJobs > 0) {
    // The append-only ledger is the source of truth; free_jobs_remaining is a
    // cache folded from it. Both, in that order, exactly as the paid path does.
    const { error: ledgerError } = await admin.from("credit_events").insert({
      contractor_id: row.referrer_contractor_id,
      delta: reward.grantedFreeJobs,
      reason: "referral_unlock",
      related_job_id: null,
      related_referral_id: row.id,
    });

    if (ledgerError) {
      // The unique index on (reason, related_referral_id) is what makes this
      // safe to race: a concurrent activation already credited this referral,
      // so skipping BOTH the insert and the cache increment leaves the balance
      // correct without a compensating decrement.
      if (ledgerError.code === UNIQUE_VIOLATION) {
        return { activated: false, reason: "already-credited" };
      }
      throw ledgerError;
    }

    await admin.rpc("increment_free_jobs_remaining", {
      p_id: row.referrer_contractor_id,
      p_delta: reward.grantedFreeJobs,
    });
  }

  // REF-3: one banked month every fifth activation, on top of the free jobs.
  if (reward.banksCredit) {
    await admin.from("referral_credits").insert({
      contractor_id: row.referrer_contractor_id,
    });
  }

  // Conditional on `status = 'pending'` so a lost race updates nothing rather
  // than re-stamping a referral another request already activated.
  await admin
    .from("referrals")
    .update({ status: "activated", referee_first_quote_job_id: input.jobId })
    .eq("id", row.id)
    .eq("status", "pending");

  return {
    activated: true,
    referralId: row.id,
    grantedFreeJobs: reward.grantedFreeJobs,
    bankedCredit: reward.banksCredit,
  };
};
