"use server";

import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/require-contractor";
import { throwIfQueryFailed } from "@/lib/query-error";
import { computeGrossProfit, computeMarginPct } from "@/lib/pnl-math";

type PnLData = {
  invoicedNet: number;
  costsNet: number;
  grossProfit: number;
  marginPct: number | null;
  unpaidCosts: number;
  hasInvoice: boolean;
};

/**
 * Compute and return P&L data for a job.
 * All amounts are returned in pence (integer).
 *
 * IMPORTANT: Invoice amounts are stored in pounds (numeric) in the database,
 * so they must be converted to pence before computation. Cost amounts are
 * already in pence (int).
 */
export async function getJobPnL(jobId: string): Promise<PnLData | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Get the contractor ID for the current user
  const contractor = await requireContractor<{ id: string }>(
    supabase,
    user.id,
    "id",
  );

  // Check ownership - get job ID only
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .eq("contractor_id", contractor.id)
    .maybeSingle();

  await throwIfQueryFailed(jobError, "jobs ownership check");
  if (!job) return null;

  // Check if a quote exists for this job
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle();

  await throwIfQueryFailed(quoteError, "quote lookup");
  if (!quote) return null;

  // Get all invoices through the quotes relationship
  const { data: invoices, error: invoicesError } = await supabase
    .from("invoices")
    .select("amount, quotes!inner(job_id)")
    .eq("quotes.job_id", jobId);

  await throwIfQueryFailed(invoicesError, "invoices select");

  // Get all costs for this job
  const { data: costs, error: costsError } = await supabase
    .from("job_costs")
    .select("amount_net, paid")
    .eq("job_id", jobId)
    .eq("contractor_id", contractor.id);

  await throwIfQueryFailed(costsError, "job costs select");

  // Convert invoice amounts from pounds to pence and sum
  // Invoice amounts are numeric(10, 2) in the DB, representing pounds
  const invoicedNetPence = (invoices ?? []).reduce((sum, inv) => {
    return sum + Math.round(inv.amount * 100);
  }, 0);

  // Cost amounts are already in pence (int), sum them directly
  const costsNetPence = (costs ?? []).reduce((sum, cost) => {
    return sum + cost.amount_net;
  }, 0);

  // Sum unpaid costs
  const unpaidCostsPence = (costs ?? [])
    .filter((cost) => !cost.paid)
    .reduce((sum, cost) => sum + cost.amount_net, 0);

  const hasInvoice = (invoices?.length ?? 0) > 0;

  // Compute P&L metrics using the functions from pnl-math
  const grossProfit = computeGrossProfit(invoicedNetPence, costsNetPence);
  const marginPct = computeMarginPct(grossProfit, invoicedNetPence);

  return {
    invoicedNet: invoicedNetPence,
    costsNet: costsNetPence,
    grossProfit,
    marginPct,
    unpaidCosts: unpaidCostsPence,
    hasInvoice,
  };
}
