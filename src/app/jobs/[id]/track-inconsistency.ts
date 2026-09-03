"use server";

import { track } from "@/lib/analytics";

/**
 * Server action to track stepper inconsistency events.
 * Called from the client-side deduplication component.
 */
export async function trackInconsistency(
  jobId: string,
  quoteId: string | undefined,
  situation: string,
  forcedStages: string[],
  inconsistencyKey: string,
): Promise<void> {
  await track("stepper_inconsistency", {
    job_id: jobId,
    quote_id: quoteId,
    situation,
    forced_stages: forcedStages,
    inconsistency_key: inconsistencyKey,
  });
}
