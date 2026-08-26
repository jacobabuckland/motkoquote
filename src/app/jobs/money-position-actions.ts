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
import { splitFeeVat, motkoFeePennies } from "@/lib/motko-fee";

export type SafeToSpend = {
  collected: number;      // pence, gross — what actually landed
  costsPaid: number;      // pence, positive; the consumer renders the sign
  motkoFees: number;      // pence, positive
  vatToSetAside: number | null;  // pence; null when not VAT-registered
  total: number;          // pence — collected − costsPaid − motkoFees − (vatToSetAside ?? 0)
};

export type Projection = {
  owedNet: number;        // pence — owed invoices, net of VAT when registered
  unpaidCostsNet: number; // pence, positive — unpaid costs, net of reclaimable VAT
  feesOnOwed: number;     // pence, positive — estimated
  total: number;          // pence — safeToSpend.total + owedNet − unpaidCostsNet − feesOnOwed
};

export type MoneyPosition = {
  owedToYou: CustomerAggregate[];
  youOwe: CounterpartyAggregate[];
  vat: VATPosition | null;
  whatsLeft: number; // pence
  safeToSpend: SafeToSpend;
  projection: Projection;
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
  let freeJobsRemaining: number;

  if (contractorIdOverride) {
    // Guard: only allow override in test environment
    if (process.env.NODE_ENV !== "test") {
      throw new Error("contractorIdOverride is only allowed in test environment");
    }

    // Testing path: use provided contractor ID
    const { data: contractor, error: contractorError } = await supabase
      .from("contractors")
      .select("id, vat_registered, free_jobs_remaining")
      .eq("id", contractorIdOverride)
      .single();

    if (contractorError || !contractor) {
      throw new Error("Contractor not found.");
    }

    contractorId = contractor.id;
    isVATRegistered = contractor.vat_registered;
    freeJobsRemaining = contractor.free_jobs_remaining;
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
      .select("id, vat_registered, free_jobs_remaining")
      .eq("owner_user_id", user.id)
      .single();

    if (contractorError || !contractor) {
      throw new Error("Contractor not found.");
    }

    contractorId = contractor.id;
    isVATRegistered = contractor.vat_registered;
    freeJobsRemaining = contractor.free_jobs_remaining;
  }

  // Fetch jobs for fee calculation
  const { data: jobsData, error: jobsError } = await supabase
    .from("jobs")
    .select("id, fee_amount_pennies, fee_status")
    .eq("contractor_id", contractorId);

  if (jobsError) {
    throw new Error(`Failed to fetch jobs: ${jobsError.message}`);
  }

  // Sum collected fees
  const motkoFees = (jobsData ?? []).reduce((sum, job) => {
    if (job.fee_status === "collected") {
      return sum + ((job.fee_amount_pennies as number | null) ?? 0);
    }
    return sum;
  }, 0);

  // Invoices this contractor has ISSUED and not been paid for.
  //
  // 'sent' is the issued-and-awaiting-payment state, and it is the vocabulary
  // the rest of the product already uses: create-payment-intent refuses to take
  // money for anything that is not 'sent', the chase cron selects on it, and the
  // dashboard labels it "Awaiting payment".
  //
  // This filter previously read `.eq("status", "unpaid")`. Nothing in the
  // product has ever written 'unpaid' — the string appeared exactly twice in
  // src/, both in this file — so the query matched nothing and "owed to you"
  // was structurally always empty, on this screen and in the voice surface that
  // shares it. There is no CHECK constraint on invoices.status, which is why a
  // filter on a value that does not exist failed silently instead of loudly.
  //
  // Drafts are deliberately excluded: status defaults to 'draft', so counting
  // them would count invoices the customer has never seen. Accepted-but-
  // uninvoiced work is excluded for the same reason — this figure means "money
  // I have asked for and not received". (Decision, 26 Aug 2026, areas/motko.md.)
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
    .eq("status", "sent");

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
      paid: false, // we filtered to status = 'sent' — issued, not yet paid
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

    // Calculate VAT on paid invoices using splitFeeVat helper
    // invoices.amount is numeric(10,2) POUNDS; splitFeeVat works in pence.
    const paidInvoicesForVAT = (paidInvoicesData ?? []).map((inv) => {
      const { vatPennies } = splitFeeVat(Math.round((inv.amount as number) * 100));
      return {
        id: inv.id,
        amount: inv.amount as number,
        vatAmount: vatPennies / 100, // convert back to pounds for PaidInvoiceForVAT type
      };
    });

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

  // Compute SafeToSpend breakdown
  let vatToSetAside: number | null = null;
  if (isVATRegistered) {
    // Sum VAT on all paid invoices using splitFeeVat
    vatToSetAside = (paidInvoicesSum ?? []).reduce((sum, inv) => {
      const { vatPennies } = splitFeeVat(Math.round((inv.amount as number) * 100));
      return sum + vatPennies;
    }, 0);
  }

  const safeToSpend: SafeToSpend = {
    collected: totalPaidInvoices,
    costsPaid: totalPaidCosts,
    motkoFees,
    vatToSetAside,
    total: totalPaidInvoices - totalPaidCosts - motkoFees - (vatToSetAside ?? 0),
  };

  // Compute Projection
  // owedNet: sum of unpaid invoices, net if VAT-registered, gross otherwise
  const owedNet = unpaidInvoices.reduce((sum, inv) => {
    const grossPennies = Math.round(inv.amount * 100);
    if (isVATRegistered) {
      const { netPennies } = splitFeeVat(grossPennies);
      return sum + netPennies;
    }
    return sum + grossPennies;
  }, 0);

  // unpaidCostsNet: sum of unpaid costs, net if VAT-registered, gross otherwise
  const unpaidCostsNet = unpaidCosts.reduce((sum, cost) => {
    if (isVATRegistered) {
      return sum + cost.amountNet;
    }
    return sum + cost.amountNet + (cost.vatAmount ?? 0);
  }, 0);

  // feesOnOwed: allocate free_jobs_remaining oldest-first, then band the rest
  // Sort unpaid invoices by created_at oldest first
  const sortedUnpaidInvoices = [...unpaidInvoices].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  let remainingFree = freeJobsRemaining;
  let feesOnOwed = 0;

  for (const inv of sortedUnpaidInvoices) {
    const grossPennies = Math.round(inv.amount * 100);
    const fee = motkoFeePennies(grossPennies, remainingFree);
    feesOnOwed += fee;
    if (remainingFree > 0) {
      remainingFree--;
    }
  }

  const projection: Projection = {
    owedNet,
    unpaidCostsNet,
    feesOnOwed,
    total: safeToSpend.total + owedNet - unpaidCostsNet - feesOnOwed,
  };

  // Get today's date in ISO format for age calculation
  const today = new Date().toISOString().split("T")[0] as string;

  return {
    owedToYou: aggregateByCustomer(unpaidInvoices, today),
    youOwe: aggregateByCounterparty(unpaidCosts),
    vat: vatPosition,
    whatsLeft,
    safeToSpend,
    projection,
  };
}
