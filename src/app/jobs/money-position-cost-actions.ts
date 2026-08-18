"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { markCostPaid } from "./[id]/cost-actions";

type CostDetail = {
  id: string;
  description: string;
  amountNet: number; // pence
  vatAmount: number | null; // pence
  jobId: string;
  jobName: string;
  incurredOn: string;
};

type InvoiceDetail = {
  id: string;
  amount: number; // pence
  createdAt: string;
  jobId: string;
  jobName: string;
  ageDays: number;
};

/**
 * Fetch detailed information about specific invoices by their IDs.
 * Used for the customer drill-down view.
 */
export async function getInvoiceDetails(invoiceIds: string[]): Promise<InvoiceDetail[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  // Get contractor
  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();

  if (contractorError || !contractor) {
    throw new Error("Contractor not found.");
  }

  // Fetch invoices with job details
  const { data: invoices, error: invoicesError } = await supabase
    .from("invoices")
    .select(
      `
      id,
      amount,
      created_at,
      quotes!inner(id, job_id, jobs!inner(id, customer_id, customers(name)))
    `,
    )
    .in("id", invoiceIds)
    .eq("quotes.jobs.contractor_id", contractor.id);

  if (invoicesError) {
    throw new Error(`Failed to fetch invoice details: ${invoicesError.message}`);
  }

  const today = new Date().toISOString().split("T")[0] as string;
  const todayMs = new Date(today).getTime();

  return (invoices ?? []).map((invoice) => {
    // Type assertion to handle nested joins
    const quote = invoice.quotes as unknown as {
      id: string;
      job_id: string;
      jobs: { id: string; customer_id: string; customers: { name: string } | null };
    };
    const customerName = quote.jobs.customers?.name ?? "Unknown";

    // Calculate age in days
    const invoiceDate = new Date(invoice.created_at).toISOString().split("T")[0] as string;
    const invoiceMs = new Date(invoiceDate).getTime();
    const ageDays = Math.round((todayMs - invoiceMs) / (1000 * 60 * 60 * 24));

    return {
      id: invoice.id,
      amount: Math.round((invoice.amount as number) * 100), // convert pounds to pence
      createdAt: invoice.created_at,
      jobId: quote.job_id,
      jobName: customerName,
      ageDays,
    };
  });
}

/**
 * Fetch detailed information about specific costs by their IDs.
 * Used for the counterparty drill-down view.
 */
export async function getCostDetails(costIds: string[]): Promise<CostDetail[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not signed in.");
  }

  // Get contractor
  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();

  if (contractorError || !contractor) {
    throw new Error("Contractor not found.");
  }

  // Fetch costs with job details
  const { data: costs, error: costsError } = await supabase
    .from("job_costs")
    .select(
      `
      id,
      description,
      amount_net,
      vat_amount,
      job_id,
      incurred_on,
      jobs!inner(id, quotes!inner(id, customers(name)))
    `,
    )
    .in("id", costIds)
    .eq("contractor_id", contractor.id);

  if (costsError) {
    throw new Error(`Failed to fetch cost details: ${costsError.message}`);
  }

  return (costs ?? []).map((cost) => {
    // Type assertion to handle nested joins
    const job = cost.jobs as unknown as {
      id: string;
      quotes: Array<{ id: string; customers: { name: string } | null }>;
    };
    const customerName = job.quotes[0]?.customers?.name ?? "Unknown";

    return {
      id: cost.id,
      description: cost.description,
      amountNet: cost.amount_net as number,
      vatAmount: cost.vat_amount as number | null,
      jobId: cost.job_id,
      jobName: customerName,
      incurredOn: cost.incurred_on,
    };
  });
}

/**
 * Mark multiple costs as paid.
 * Calls the existing markCostPaid action for each cost and revalidates the money position.
 */
export async function markCostsPaid(
  costIds: string[],
  paidOn: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Mark each cost as paid
  for (const costId of costIds) {
    const result = await markCostPaid({ costId, paidOn });
    if (!result.ok) {
      return result;
    }
  }

  // Revalidate the money position page
  revalidatePath("/jobs");
  return { ok: true };
}
