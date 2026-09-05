"use server";

/**
 * REFUND-1: Server actions for refund operations
 *
 * Thin wrappers around the core refund logic, callable from client components.
 */

import { getRefundEligibility, refundJob } from "@/lib/refund-settlement";
import { revalidatePath } from "next/cache";

type RefundEligibility =
  | { eligible: true; maxRefundablePennies: number }
  | { eligible: false; reason: string };

type RefundResult =
  | { success: true; refundId: string; newState: string }
  | { success: false; error: string };

/**
 * Check refund eligibility for a job.
 * Exposed as a server action for client components.
 */
export async function checkRefundEligibility(
  jobId: string,
): Promise<RefundEligibility> {
  return await getRefundEligibility(jobId);
}

/**
 * Process a refund for a job.
 * Exposed as a server action for client components.
 */
export async function processRefund(
  jobId: string,
  refundAmountPennies: number,
): Promise<RefundResult> {
  const result = await refundJob(jobId, refundAmountPennies);

  // Revalidate the job page to show updated state
  if (result.success) {
    revalidatePath(`/jobs/${jobId}`);
  }

  return result;
}
