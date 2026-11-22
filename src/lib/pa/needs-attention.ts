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
  // What happens next, in one sentence, for every situation. This is what the
  // assistant should say when asked "what now?" or "how do I get to the invoice?"
  // rather than working it out from memory.
  nextStep: string;
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

// The whole path, in the order the app enforces it: quote, accept, contract,
// sign, deposit invoice, work complete, final invoice, paid. The contract is
// sent from the job page; the invoices can be raised from chat.
export const NEXT_STEP: Record<Situation, string> = {
  draft_quote: "Check the draft, confirm pricing, crew and materials, then send it.",
  quote_sent: "Waiting for the customer to accept. You'll get a notification when they do.",
  quote_declined: "The customer declined. Change the quote and send it again, or leave it.",
  quote_archived: "This quote is archived.",
  accepted_need_contract:
    "Accepted. Next is the contract, which you send from the job page. The invoice comes after it's signed.",
  contract_sent: "Waiting for the customer to sign the contract.",
  contract_declined: "The contract was declined. Fix the quote and send it again from the job page.",
  signed_need_invoice: "The contract is signed. The deposit invoice is next, and I can set that up for you to confirm.",
  work_complete: "The work is marked complete. The final invoice is next, and I can set that up for you to confirm.",
  invoice_unpaid: "Waiting for the customer to pay.",
  invoice_overdue: "The invoice is overdue. Time to chase it.",
  paid: "Paid. Nothing more to do.",
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
    nextStep: NEXT_STEP[situation],
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
