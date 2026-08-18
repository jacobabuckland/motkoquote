/**
 * Ledger computation functions.
 * These are the single source of truth for financial projections,
 * shared by both on-screen displays and voice queries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OutstandingTotal {
  total: number;
  invoices: Array<{
    id: string;
    amount: number;
    dueDate?: string;
    customerName?: string;
    [key: string]: unknown;
  }>;
}

export interface UnpaidCosts {
  total: number;
  byCounterparty: Array<{
    counterparty: string;
    amount: number;
  }>;
}

export interface UnpaidCostsForCounterparty {
  counterparty: string;
  amount: number;
}

export interface JobProfitAndLoss {
  jobId: string;
  customerName?: string;
  revenue: number;
  costs: number;
  profit: number;
}

export interface WhatsLeft {
  collected: number;
  paidCosts: number;
  remaining: number;
}

/**
 * Computes total outstanding (unpaid) invoices.
 */
export async function computeOutstandingTotal(
  supabase: SupabaseClient,
  contractorId: string
): Promise<OutstandingTotal> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .neq("status", "paid")
    .eq("contractor_id", contractorId);

  if (error) {
    throw new Error(`Failed to fetch outstanding invoices: ${error.message}`);
  }

  const invoices = data || [];
  const total = invoices.reduce((sum, invoice) => sum + (invoice.amount || 0), 0);

  return {
    total,
    invoices: invoices.map((inv) => ({
      id: inv.id,
      amount: inv.amount,
      dueDate: inv.due_date,
      customerName: inv.customer_name,
    })),
  };
}

/**
 * Computes total unpaid costs, grouped by counterparty.
 */
export async function computeUnpaidCosts(
  supabase: SupabaseClient,
  contractorId: string
): Promise<UnpaidCosts> {
  const { data, error } = await supabase
    .from("costs")
    .select("*")
    .eq("contractor_id", contractorId)
    .neq("paid", true);

  if (error) {
    throw new Error(`Failed to fetch unpaid costs: ${error.message}`);
  }

  const costs = data || [];
  const total = costs.reduce((sum, cost) => sum + (cost.amount || 0), 0);

  // Group by counterparty
  const byCounterparty = costs.reduce<Array<{ counterparty: string; amount: number }>>(
    (acc, cost) => {
      const counterparty = cost.counterparty || "Unknown";
      const existing = acc.find((item) => item.counterparty === counterparty);
      if (existing) {
        existing.amount += cost.amount || 0;
      } else {
        acc.push({ counterparty, amount: cost.amount || 0 });
      }
      return acc;
    },
    []
  );

  return { total, byCounterparty };
}

/**
 * Computes unpaid costs for a specific counterparty.
 */
export async function computeUnpaidCostsForCounterparty(
  supabase: SupabaseClient,
  contractorId: string,
  counterparty: string
): Promise<UnpaidCostsForCounterparty> {
  const { data, error } = await supabase
    .from("costs")
    .select("*")
    .eq("contractor_id", contractorId)
    .eq("counterparty", counterparty)
    .neq("paid", true);

  if (error) {
    throw new Error(`Failed to fetch unpaid costs for counterparty: ${error.message}`);
  }

  const costs = data || [];
  const amount = costs.reduce((sum, cost) => sum + (cost.amount || 0), 0);

  return { counterparty, amount };
}

/**
 * Computes profit and loss for a specific job.
 * P&L = revenue - costs
 */
export async function computeJobProfitAndLoss(
  supabase: SupabaseClient,
  jobId: string,
  _contractorId: string
): Promise<JobProfitAndLoss> {
  // Fetch invoices for this job
  const { data: invoices, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("job_id", jobId);

  if (invoiceError) {
    throw new Error(`Failed to fetch job invoices: ${invoiceError.message}`);
  }

  // Fetch costs for this job
  const { data: costs, error: costError } = await supabase
    .from("costs")
    .select("*")
    .eq("job_id", jobId);

  if (costError) {
    throw new Error(`Failed to fetch job costs: ${costError.message}`);
  }

  const revenue = (invoices || []).reduce((sum, inv) => sum + (inv.amount || 0), 0);
  const totalCosts = (costs || []).reduce((sum, cost) => sum + (cost.amount || 0), 0);
  const profit = revenue - totalCosts;

  return {
    jobId,
    revenue,
    costs: totalCosts,
    profit,
  };
}

/**
 * Computes what's left: collected revenue minus paid costs.
 */
export async function computeWhatsLeft(
  supabase: SupabaseClient,
  contractorId: string
): Promise<WhatsLeft> {
  // Fetch paid invoices
  const { data: paidInvoices, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("contractor_id", contractorId);

  if (invoiceError) {
    throw new Error(`Failed to fetch paid invoices: ${invoiceError.message}`);
  }

  // Fetch paid costs
  const { data: paidCosts, error: costError } = await supabase
    .from("costs")
    .select("*")
    .eq("contractor_id", contractorId);

  if (costError) {
    throw new Error(`Failed to fetch paid costs: ${costError.message}`);
  }

  // Filter to paid items (in case the query didn't filter by status)
  const paidInvoicesFiltered = (paidInvoices || []).filter((inv) => inv.status === "paid");
  const paidCostsFiltered = (paidCosts || []).filter((cost) => cost.paid === true);

  const collected = paidInvoicesFiltered.reduce((sum, inv) => sum + (inv.amount || 0), 0);
  const paidCostsTotal = paidCostsFiltered.reduce(
    (sum, cost) => sum + (cost.amount || 0),
    0
  );
  const remaining = collected - paidCostsTotal;

  return {
    collected,
    paidCosts: paidCostsTotal,
    remaining,
  };
}
