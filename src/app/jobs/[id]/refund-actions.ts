"use server";

// REFUND-1 — the two server actions behind the refund control.
//
// A server action is a public HTTP endpoint that happens to be written as a
// function, so "only the refund button calls it" is not a security property.
// This one moves money, so it authenticates explicitly AND hands the refund
// logic the user-scoped Supabase client, whose RLS policy on `jobs` scopes
// every read and write to the signed-in trade's own jobs. Two locks: a caller
// with no session is refused here, and a caller with someone else's job id
// finds it absent there.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import {
  getRefundEligibility,
  refundJob,
  getStageRefundEligibility,
  refundStage,
  type RefundDeps,
  type RefundEligibility,
  type RefundResult,
} from "@/lib/refund-settlement";

const refundInput = z.object({
  jobId: z.string().uuid(),
  // Pennies. Integer by construction — the dialog collects pounds and converts
  // once, so a fractional penny here is a caller that got it wrong.
  amountPennies: z.number().int().positive(),
});

const jobIdInput = z.string().uuid();

/** The session's own client and Stripe, or null when either is unavailable. */
const authorisedDeps = async (): Promise<RefundDeps | null> => {
  if (!stripe) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, stripe };
};

export async function checkRefundEligibility(jobId: string): Promise<RefundEligibility> {
  const parsed = jobIdInput.safeParse(jobId);
  if (!parsed.success) return { eligible: false, reason: "Job not found." };

  const deps = await authorisedDeps();
  if (!deps) return { eligible: false, reason: "Sign in to refund this job." };

  return getRefundEligibility(parsed.data, deps);
}

export async function processRefund(
  jobId: string,
  amountPennies: number,
): Promise<RefundResult> {
  const parsed = refundInput.safeParse({ jobId, amountPennies });
  if (!parsed.success) {
    return { success: false, error: "Enter a refund amount greater than zero." };
  }

  const deps = await authorisedDeps();
  if (!deps) return { success: false, error: "Sign in to refund this job." };

  const result = await refundJob(parsed.data.jobId, parsed.data.amountPennies, deps);

  if (result.success) {
    revalidatePath(`/jobs/${parsed.data.jobId}`);
  }

  return result;
}

// REFUND-2 — stage-aware server actions for refunding individual payment stages.

const stageRefundInput = z.object({
  jobId: z.string().uuid(),
  stageNumber: z.number().int().positive(),
  amountPennies: z.number().int().positive(),
});

const stageIdInput = z.object({
  jobId: z.string().uuid(),
  stageNumber: z.number().int().positive(),
});

export async function checkStageRefundEligibility(
  jobId: string,
  stageNumber: number,
): Promise<RefundEligibility> {
  const parsed = stageIdInput.safeParse({ jobId, stageNumber });
  if (!parsed.success) return { eligible: false, reason: "Stage not found." };

  const deps = await authorisedDeps();
  if (!deps) return { eligible: false, reason: "Sign in to refund this stage." };

  return getStageRefundEligibility(parsed.data.jobId, parsed.data.stageNumber, deps);
}

export async function processStageRefund(
  jobId: string,
  stageNumber: number,
  amountPennies: number,
): Promise<RefundResult> {
  const parsed = stageRefundInput.safeParse({ jobId, stageNumber, amountPennies });
  if (!parsed.success) {
    return { success: false, error: "Enter a refund amount greater than zero." };
  }

  const deps = await authorisedDeps();
  if (!deps) return { success: false, error: "Sign in to refund this stage." };

  const result = await refundStage(
    parsed.data.jobId,
    parsed.data.stageNumber,
    parsed.data.amountPennies,
    deps,
  );

  if (result.success) {
    revalidatePath(`/jobs/${parsed.data.jobId}`);
  }

  return result;
}
