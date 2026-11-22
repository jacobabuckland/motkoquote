// The progress card: where a job is on the path, and what happens next.
//
// The stages come from deriveJobState, the derivation the job page itself runs,
// so the chat can never show a different stage from the page it links to.

import { deriveJobState } from "@/lib/job-stages";
import { deriveJobTitle } from "@/lib/schemas/sow";
import { quoteStateOf, sanitiseForModel, type JobBundle } from "./data";
import { NEXT_STEP } from "./needs-attention";
import type { ProgressCard } from "./types";

export const buildProgressCard = (bundle: JobBundle, nowMs: number): ProgressCard | null => {
  // No quote yet means no path to show.
  if (!bundle.quote) return null;
  const state = deriveJobState(
    quoteStateOf(bundle.quote),
    bundle.contract,
    bundle.invoices,
    nowMs,
    bundle.job.work_completed_at,
    bundle.stages,
    bundle.job.archived_at,
  );
  return {
    type: "progress",
    jobId: bundle.job.id,
    customerName: bundle.customer?.name ? sanitiseForModel(bundle.customer.name, 60) : null,
    title: sanitiseForModel(
      deriveJobTitle(bundle.sow, bundle.job.extracted_json?.job_type) || "Job",
      60,
    ),
    stages: state.stages,
    movesWith: state.move === "contractor" ? "you" : state.move === "customer" ? "customer" : "nobody",
    nextStep: NEXT_STEP[state.situation],
  };
};
