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
      contractor: {
        company_name: string;
        payout_details_complete: boolean;
      };
    };
  };
};

export const signContract = async (contractId: string, signerName: string) => {
  const admin = createAdminClient();

  const { data: contract } = await admin
    .from("contracts")
    .select(
      "status, deposit_pct, quote:quotes(id, total, job:jobs(id, customer:customers(name, contact), contractor:contractors(company_name, payout_details_complete)))",
    )
    .eq("id", contractId)
    .single();

  if (!contract) throw new Error("Contract not found");

  // Idempotency guard: a double-tap on Sign must not sign twice, raise a
  // second deposit invoice, or fire a duplicate contractor notification.
  // Only the transition out of an unsigned state does any work.
  const { status, deposit_pct: depositPct, quote } =
    contract as unknown as ContractWithRelations & { status: string };
  if (status === "signed") return;
  const { job } = quote;

  const { data: updated, error } = await admin
    .from("contracts")
    .update({ status: "signed", signer_name: signerName, signed_at: new Date().toISOString() })
    .eq("id", contractId)
    .neq("status", "signed")
    .select("id");

  if (error) throw new Error(error.message);
  // Another concurrent request won the race and already signed it — bail
  // before the deposit invoice / notification so neither fires twice.
  if (!updated || updated.length === 0) return;

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
      payoutDetailsComplete: job.contractor.payout_details_complete,
    });
  }

  const customerName = job.customer?.name ?? "Your customer";
  await notifyContractorOfCustomerAction(admin, {
    jobId: job.id,
    event: "contract_signed",
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
    .select("status, quote:quotes(job:jobs(id, customer:customers(name)))")
    .eq("id", contractId)
    .maybeSingle();

  // Idempotency guard: skip if already declined so a double-tap can't fire a
  // second contractor notification.
  if ((contract as { status?: string } | null)?.status === "declined") return;

  const { data: updated, error } = await admin
    .from("contracts")
    .update({ status: "declined" })
    .eq("id", contractId)
    .neq("status", "declined")
    .select("id");

  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) return;

  const row = contract as unknown as {
    quote: { job: { id: string; customer: { name: string } | null } | null } | null;
  } | null;
  const job = row?.quote?.job;
  if (job) {
    const customerName = job.customer?.name ?? "Your customer";
    await notifyContractorOfCustomerAction(admin, {
      jobId: job.id,
      event: "contract_declined",
      subject: `${customerName} declined the contract`,
      heading: `${customerName} declined the contract.`,
      nextStep: "Nothing needs you here — reach out to them if you'd like to talk it through.",
    });
  }
};
