"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createInvoiceRecord } from "@/lib/invoicing";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";

type ContractWithRelations = {
  deposit_pct: number | null;
  quote: {
    id: string;
    total: number;
    job: {
      id: string;
      customer: { name: string; contact: { email?: string } } | null;
      contractor: { company_name: string };
    };
  };
};

export const signContract = async (contractId: string, signerName: string) => {
  const admin = createAdminClient();

  const { data: contract } = await admin
    .from("contracts")
    .select(
      "deposit_pct, quote:quotes(id, total, job:jobs(id, customer:customers(name, contact), contractor:contractors(company_name)))",
    )
    .eq("id", contractId)
    .single();

  if (!contract) throw new Error("Contract not found");

  const { deposit_pct: depositPct, quote } = contract as unknown as ContractWithRelations;
  const { job } = quote;

  const { error } = await admin
    .from("contracts")
    .update({ status: "signed", signer_name: signerName, signed_at: new Date().toISOString() })
    .eq("id", contractId);

  if (error) throw new Error(error.message);

  // A deposit percentage on the contract implies a deposit invoice should
  // be raised the moment the customer signs — no separate contractor step.
  if (depositPct) {
    const amount = Math.round(quote.total * (depositPct / 100) * 100) / 100;
    await createInvoiceRecord(admin, {
      quoteId: quote.id,
      invoiceType: "deposit",
      amount,
      companyName: job.contractor.company_name,
      customerName: job.customer?.name ?? "Customer",
      customerEmail: job.customer?.contact?.email,
    });
  }

  const customerName = job.customer?.name ?? "Your customer";
  await notifyContractorOfCustomerAction(admin, {
    jobId: job.id,
    subject: `${customerName} signed the contract`,
    heading: `${customerName} signed the contract.`,
    nextStep: depositPct
      ? "We've raised the deposit invoice for you — nothing needed until it's paid."
      : "Next step: raise an invoice to get paid.",
  });
};

export const declineContract = async (contractId: string) => {
  const admin = createAdminClient();

  const { data: contract } = await admin
    .from("contracts")
    .select("quote:quotes(job:jobs(id, customer:customers(name)))")
    .eq("id", contractId)
    .maybeSingle();

  const { error } = await admin.from("contracts").update({ status: "declined" }).eq("id", contractId);

  if (error) throw new Error(error.message);

  const row = contract as unknown as {
    quote: { job: { id: string; customer: { name: string } | null } | null } | null;
  } | null;
  const job = row?.quote?.job;
  if (job) {
    const customerName = job.customer?.name ?? "Your customer";
    await notifyContractorOfCustomerAction(admin, {
      jobId: job.id,
      subject: `${customerName} declined the contract`,
      heading: `${customerName} declined the contract.`,
      nextStep: "Nothing needs you here — reach out to them if you'd like to talk it through.",
    });
  }
};
