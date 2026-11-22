// "What needs me?" — the jobs where the next move is the contractor's.
//
// Driven by deriveSituation in job-stages, the same function the job page and
// the dashboard use, so the chat strip cannot disagree with them about whose
// move it is. An overdue invoice is the customer's move on paper but the
// contractor's to chase, so it is included.

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveSituation, type Situation } from "@/lib/job-stages";
import { deriveJobTitle } from "@/lib/schemas/sow";
import { computeQuoteTotals } from "@/lib/quote-math";
import {
  lineItemsOf,
  loadJobBundles,
  quoteStateOf,
  sanitiseForModel,
  type JobBundle,
} from "./data";

export type JobSummary = {
  jobId: string;
  customer: string | null;
  title: string;
  situation: Situation;
  movesWith: "you" | "customer" | "nobody";
  // Computed by quote-math from the stored lines; null when there is no quote.
  total: number | null;
};

export type AttentionItem = {
  jobId: string;
  customer: string | null;
  title: string;
  situation: Situation;
  why: string;
};

const WHY: Partial<Record<Situation, string>> = {
  draft_quote: "Draft quote waiting for you to check and send",
  accepted_need_contract: "Accepted. A contract is next",
  contract_declined: "Contract declined. Fix the quote and send again",
  signed_need_invoice: "Contract signed. The deposit invoice is next",
  work_complete: "Work complete. The final invoice is next",
  invoice_overdue: "Invoice overdue. Time to chase",
};

export const summariseJob = (
  bundle: JobBundle,
  vatRegistered: boolean,
  nowMs: number,
): JobSummary => {
  const { situation, move } = deriveSituation(
    quoteStateOf(bundle.quote),
    bundle.contract,
    bundle.invoices,
    nowMs,
    bundle.job.work_completed_at,
    bundle.stages,
    bundle.job.archived_at,
  );
  return {
    jobId: bundle.job.id,
    customer: bundle.customer?.name ? sanitiseForModel(bundle.customer.name, 60) : null,
    title: sanitiseForModel(
      deriveJobTitle(bundle.sow, bundle.job.extracted_json?.job_type) || "Job",
      60,
    ),
    situation,
    movesWith: move === "contractor" ? "you" : move === "customer" ? "customer" : "nobody",
    total: bundle.quote
      ? computeQuoteTotals(lineItemsOf(bundle.quote), vatRegistered).total
      : null,
  };
};

const isEmptyDraft = (bundle: JobBundle): boolean =>
  (!bundle.quote || lineItemsOf(bundle.quote).length === 0) && !bundle.customer;

export const loadNeedsAttention = async (
  db: SupabaseClient,
  contractor: { id: string; vat_registered: boolean },
  nowMs: number,
): Promise<AttentionItem[]> => {
  const bundles = await loadJobBundles(db, contractor.id);
  const items: AttentionItem[] = [];
  for (const bundle of bundles) {
    if (isEmptyDraft(bundle)) continue;
    const summary = summariseJob(bundle, contractor.vat_registered, nowMs);
    const why = WHY[summary.situation];
    if (!why) continue;
    if (summary.movesWith !== "you" && summary.situation !== "invoice_overdue") continue;
    items.push({
      jobId: summary.jobId,
      customer: summary.customer,
      title: summary.title,
      situation: summary.situation,
      why,
    });
  }
  return items;
};
