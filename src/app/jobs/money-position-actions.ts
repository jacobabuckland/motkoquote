"use server";

import { createClient } from "@/lib/supabase/server";
import {
  aggregateByCounterparty,
  aggregateByCustomer,
  computeVATPosition,
  type CounterpartyAggregate,
  type CustomerAggregate,
  type VATPosition,
} from "@/lib/money-position-math";

export type MoneyPosition = {
  owedToYou: CustomerAggregate[];
  youOwe: CounterpartyAggregate[];
  vat: VATPosition | null;
  whatsLeft: number; // pence
};

/**
 * Fetches and computes the cross-job money position for the current contractor.
 * All amounts are returned in integer pence.
 *
 * @param contractorIdOverride - Optional contractor ID for testing. Only allowed
 *                                in test environment (NODE_ENV === 'test').
 *                                In production, always uses the authenticated user's contractor.
 */
export async function getMoneyPosition(contractorIdOverride?: string): Promise<MoneyPosition> {
  const supabase = await createClient();

  let contractorId: string;
  let isVATRegistered: boolean;

  if (contractorIdOverride) {
    // Guard: only allow override in test environment
    if (process.env.NODE_ENV !== "test") {
      throw new Error("contractorIdOverride is only allowed in test environment");
    }

    // Testing path: use provided contractor ID
    const { data: contractor, error: contractorError } = await supabase
      .from("contractors")
      .select("id, vat_registered")
      .eq("id", contractorIdOverride)
      .single();

    if (contractorError || !contractor) {
      throw new Error("Contractor not found.");
    }

    contractorId = contractor.id;
    isVATRegistered = contractor.vat_registered;
  } else {
    // Production path: get contractor from current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Not signed in.");
    }

    // Get contractor
    const { data: contractor, error: contractorError } = await supabase
      .from("contractors")
      .select("id, vat_registered")
      .eq("owner_user_id", user.id)
      .single();

    if (contractorError || !contractor) {
      throw new Error("Contractor not found.");
    }

    contractorId = contractor.id;
    isVATRegistered = contractor.vat_registered;
  }

  // Fetch all unpaid invoices across all jobs for this contractor
  const { data: invoicesData, error: invoicesError } = await supabase
    .from("invoices")
    .select(
      `
      id,
      amount,
      created_at,
      status,
      quotes!inner(job_id, jobs!inner(customer_id, customers(name)))
    `,
    )
    .eq("quotes.jobs.contractor_id", contractorId)
    .eq("status", "unpaid");

  if (invoicesError) {
    throw new Error(`Failed to fetch invoices: ${invoicesError.message}`);
  }

  // Map to UnpaidInvoice format
  const unpaidInvoices = (invoicesData ?? []).map((inv) => {
    // Type assertion to handle nested joins
    const quote = inv.quotes as unknown as {
      job_id: string;
      jobs: { customer_id: string; customers: { name: string } | null };
    };
    const customerName = quote.jobs.customers?.name ?? "Unknown";
    const customerId = quote.jobs.customer_id;

    return {
      id: inv.id,
      customerId,
      customerName,
      amount: inv.amount as number,
      createdAt: inv.created_at,
      paid: false, // we filtered to status = 'unpaid'
    };
  });

  // Fetch all unpaid job_costs for this contractor
  const { data: costsData, error: costsError } = await supabase
    .from("job_costs")
    .select("id, job_id, counterparty_id, amount_net, vat_amount, paid, counterparty:counterparties(name)")
    .eq("contractor_id", contractorId)
    .eq("paid", false);

  if (costsError) {
    throw new Error(`Failed to fetch costs: ${costsError.message}`);
  }

  // Map to UnpaidCost format
  const unpaidCosts = (costsData ?? []).map((cost) => ({
    id: cost.id,
    counterpartyId: cost.counterparty_id,
    counterpartyName: (cost.counterparty as unknown as { name: string } | null)?.name ?? null,
    amountNet: cost.amount_net as number,
    vatAmount: cost.vat_amount as number | null,
    jobId: cost.job_id,
    paid: false, // we filtered to paid = false
  }));

  // Fetch paid invoices for VAT calculation (only if VAT-registered)
  let vatPosition: VATPosition | null = null;
  if (isVATRegistered) {
    const { data: paidInvoicesData, error: paidInvoicesError } = await supabase
      .from("invoices")
      .select(
        `
        id,
        amount,
        quotes!inner(job_id, jobs!inner(contractor_id))
      `,
      )
      .eq("quotes.jobs.contractor_id", contractorId)
      .eq("status", "paid");

    if (paidInvoicesError) {
      throw new Error(`Failed to fetch paid invoices: ${paidInvoicesError.message}`);
    }

    // Calculate VAT on paid invoices (standard rate: 20%)
    const paidInvoicesForVAT = (paidInvoicesData ?? []).map((inv) => ({
      id: inv.id,
      amount: inv.amount as number,
      vatAmount: (inv.amount as number) * 0.2,
    }));

    // Fetch paid costs for VAT calculation
    const { data: paidCostsData, error: paidCostsError } = await supabase
      .from("job_costs")
      .select("id, vat_amount")
      .eq("contractor_id", contractorId)
      .eq("paid", true);

    if (paidCostsError) {
      throw new Error(`Failed to fetch paid costs: ${paidCostsError.message}`);
    }

    const paidCostsForVAT = (paidCostsData ?? []).map((cost) => ({
      id: cost.id,
      vatAmount: cost.vat_amount as number | null,
    }));

    vatPosition = computeVATPosition(paidInvoicesForVAT, paidCostsForVAT);
  }

  // Compute "what's left": money collected minus costs paid (both net and VAT)
  // Fetch sum of paid invoice amounts
  const { data: paidInvoicesSum } = await supabase
    .from("invoices")
    .select(
      `
      amount,
      quotes!inner(job_id, jobs!inner(contractor_id))
    `,
    )
    .eq("quotes.jobs.contractor_id", contractorId)
    .eq("status", "paid");

  const totalPaidInvoices = (paidInvoicesSum ?? []).reduce(
    (sum, inv) => sum + Math.round((inv.amount as number) * 100),
    0,
  );

  // Fetch sum of paid costs (net + VAT)
  const { data: paidCostsSum } = await supabase
    .from("job_costs")
    .select("amount_net, vat_amount")
    .eq("contractor_id", contractorId)
    .eq("paid", true);

  const totalPaidCosts = (paidCostsSum ?? []).reduce((sum, cost) => {
    const net = (cost.amount_net as number) ?? 0;
    const vat = (cost.vat_amount as number | null) ?? 0;
    return sum + net + vat;
  }, 0);

  const whatsLeft = totalPaidInvoices - totalPaidCosts;

  // Get today's date in ISO format for age calculation
  const today = new Date().toISOString().split("T")[0] as string;

  return {
    owedToYou: aggregateByCustomer(unpaidInvoices, today),
    youOwe: aggregateByCounterparty(unpaidCosts),
    vat: vatPosition,
    whatsLeft,
  };
}
