"use server";

import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/require-contractor";
import { throwIfQueryFailed } from "@/lib/query-error";
import { computeGrossProfit, computeMarginPct } from "@/lib/pnl-math";
import { invoiceNet } from "@/lib/vat-record";

type PnLData = {
  invoicedNet: number;
  costsNet: number;
  grossProfit: number;
  marginPct: number | null;
  unpaidCosts: number;
  hasInvoice: boolean;
  costCount?: number;
  // Whether `invoicedNet` is genuinely net. False when any invoice predates
  // migration 80 and so has no recorded VAT — the figure is then that row's
  // GROSS, because there is no honest way to derive its net. The card reads
  // this to decide whether it may say "(net)" at all; see the note below.
  //
  // Optional on the TYPE only so that callers written before it — the frozen
  // fixtures in tests/acceptance/457.test.tsx — still satisfy it. `getJobPnL`
  // always sets it.
  netIsExact?: boolean;
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
    .select("amount, vat_amount, quotes!inner(job_id)")
    .eq("quotes.job_id", jobId);

  await throwIfQueryFailed(invoicesError, "invoices select");

  // Get all costs for this job
  const { data: costs, error: costsError } = await supabase
    .from("job_costs")
    .select("amount_net, paid")
    .eq("job_id", jobId)
    .eq("contractor_id", contractor.id);

  await throwIfQueryFailed(costsError, "job costs select");

  // INVOICES ARE STORED GROSS, AND THIS FIGURE IS LABELLED NET.
  //
  // Reported 14 Sep: a VAT-registered limited company's job read "Invoiced
  // (net) £3,620.28" against a net of £3,016.90, producing "Gross profit
  // £3,620.28 / 100.0%" on a job with no costs. Costs are stored as
  // `amount_net` and genuinely are net, so gross revenue was being set against
  // net costs — the profit was overstated by the whole of the VAT collected,
  // and the label asserted the wrong number was the right kind.
  //
  // `invoiceNet` returns null where `vat_amount` was never recorded, which is
  // the honest answer for a row raised before migration 80: unknown, not zero.
  // Taking a sixth of gross for those is exactly the invention D14 was about,
  // so this does NOT do it — such a row contributes its gross and clears
  // `netIsExact`, and the card then drops the "(net)" rather than lying about
  // a figure it cannot derive.
  //
  // Invoice amounts are numeric(10, 2) in the DB, representing pounds.
  const netByInvoice = (invoices ?? []).map((inv) =>
    invoiceNet({ amount: inv.amount, vat_amount: inv.vat_amount ?? null }),
  );
  const netIsExact = netByInvoice.every((net) => net !== null);
  const invoicedNetPence = (invoices ?? []).reduce((sum, inv, index) => {
    return sum + Math.round((netByInvoice[index] ?? inv.amount) * 100);
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
  const costCount = (costs ?? []).length;

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
    costCount,
    netIsExact,
  };
}
