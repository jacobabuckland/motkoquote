"use server";

import { createClient } from "@/lib/supabase/server";
import { computeGrossProfit, computeMarginPct } from "@/lib/pnl-math";

type PnLData = {
  invoicedNet: number;
  costsNet: number;
  grossProfit: number;
  marginPct: number | null;
  vatCollected: number;
  vatOnCosts: number;
  vatPosition: number;
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
  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();

  if (contractorError || !contractor) return null;

  // Get the job with its quote_id
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, quote_id")
    .eq("id", jobId)
    .eq("contractor_id", contractor.id)
    .single();

  if (jobError || !job || !job.quote_id) return null;

  // Get all invoices for this quote
  const { data: invoices, error: invoicesError } = await supabase
    .from("invoices")
    .select("amount, vat_amount")
    .eq("quote_id", job.quote_id);

  if (invoicesError) return null;

  // Get all costs for this job
  const { data: costs, error: costsError } = await supabase
    .from("job_costs")
    .select("amount_net, vat_amount, paid")
    .eq("job_id", jobId)
    .eq("contractor_id", contractor.id);

  if (costsError) return null;

  // Convert invoice amounts from pounds to pence and sum
  // Invoice amounts are numeric(10, 2) in the DB, representing pounds
  const invoicedNetPence = (invoices ?? []).reduce((sum, inv) => {
    return sum + Math.round(inv.amount * 100);
  }, 0);

  // Sum VAT on invoices (also in pounds, convert to pence)
  const vatCollectedPence = (invoices ?? []).reduce((sum, inv) => {
    return sum + Math.round((inv.vat_amount ?? 0) * 100);
  }, 0);

  // Cost amounts are already in pence (int), sum them directly
  const costsNetPence = (costs ?? []).reduce((sum, cost) => {
    return sum + cost.amount_net;
  }, 0);

  // Sum VAT on costs (already in pence, treat null as 0)
  const vatOnCostsPence = (costs ?? []).reduce((sum, cost) => {
    return sum + (cost.vat_amount ?? 0);
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
    vatCollected: vatCollectedPence,
    vatOnCosts: vatOnCostsPence,
    vatPosition: vatCollectedPence - vatOnCostsPence,
    unpaidCosts: unpaidCostsPence,
    hasInvoice,
  };
}
