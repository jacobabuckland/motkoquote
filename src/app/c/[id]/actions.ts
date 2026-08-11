"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createInvoiceRecord } from "@/lib/invoicing";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";
import { checkRateLimits, getRateLimitConfig } from "@/lib/rate-limit";
import { getClientIpFromHeaders } from "@/lib/get-client-ip";

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
  // Rate limiting: per-IP and per-resource (logical AND)
  const headersList = await headers();
  const clientIp = getClientIpFromHeaders(headersList);
  const authHeader = headersList.get("authorization");
  const isServiceCaller = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const checks = [];

  const ipConfig = getRateLimitConfig("RATE_LIMIT_CUSTOMER_ACTION_PER_IP", "RATE_LIMIT_CUSTOMER_ACTION_WINDOW_IP");
  if (ipConfig && clientIp) {
    checks.push({ key: `customer-action:ip:${clientIp}`, config: ipConfig });
  }

  const resourceConfig = getRateLimitConfig("RATE_LIMIT_CUSTOMER_ACTION_PER_RESOURCE", "RATE_LIMIT_CUSTOMER_ACTION_WINDOW_RESOURCE");
  if (resourceConfig) {
    checks.push({ key: `customer-action:resource:${contractId}`, config: resourceConfig });
  }

  if (checks.length > 0) {
    const limitResult = await checkRateLimits(checks, { skipAuth: isServiceCaller });
    if (!limitResult.allowed) {
      throw new Error(`Too many requests. Please try again in ${limitResult.retryAfter} seconds.`);
    }
  }

  const admin = createAdminClient();

  const { data: contract } = await admin
    .from("contracts")
    .select(
      "status, deposit_pct, quote:quotes(id, total, job:jobs(id, customer:customers(name, contact), contractor:contractors(company_name, payout_details_complete)))",
    )
    .eq("id", contractId)
    .single();

  if (!contract) throw new Error("Contract not found");

  // State-machine guard: a contract may only be signed while it is still
  // awaiting signature (status 'sent'). Asserting the exact legal PRIOR state —
  // not merely "not already signed" — is what blocks a *declined* contract from
  // being flipped to signed and (worse) raising a deposit invoice from a
  // terminal state. It also preserves idempotency: a re-tap on an already-signed
  // contract matches no row and no-ops.
  const { status, deposit_pct: depositPct, quote } =
    contract as unknown as ContractWithRelations & { status: string };
  if (status !== "sent") return;
  const { job } = quote;

  const { data: updated, error } = await admin
    .from("contracts")
    .update({ status: "signed", signer_name: signerName, signed_at: new Date().toISOString() })
    .eq("id", contractId)
    .eq("status", "sent")
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
  // Rate limiting: per-IP and per-resource (logical AND)
  const headersList = await headers();
  const clientIp = getClientIpFromHeaders(headersList);
  const authHeader = headersList.get("authorization");
  const isServiceCaller = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const checks = [];

  const ipConfig = getRateLimitConfig("RATE_LIMIT_CUSTOMER_ACTION_PER_IP", "RATE_LIMIT_CUSTOMER_ACTION_WINDOW_IP");
  if (ipConfig && clientIp) {
    checks.push({ key: `customer-action:ip:${clientIp}`, config: ipConfig });
  }

  const resourceConfig = getRateLimitConfig("RATE_LIMIT_CUSTOMER_ACTION_PER_RESOURCE", "RATE_LIMIT_CUSTOMER_ACTION_WINDOW_RESOURCE");
  if (resourceConfig) {
    checks.push({ key: `customer-action:resource:${contractId}`, config: resourceConfig });
  }

  if (checks.length > 0) {
    const limitResult = await checkRateLimits(checks, { skipAuth: isServiceCaller });
    if (!limitResult.allowed) {
      throw new Error(`Too many requests. Please try again in ${limitResult.retryAfter} seconds.`);
    }
  }

  const admin = createAdminClient();

  const { data: contract } = await admin
    .from("contracts")
    .select("status, quote:quotes(job:jobs(id, customer:customers(name)))")
    .eq("id", contractId)
    .maybeSingle();

  // State-machine guard: a contract may only be declined while it is still
  // awaiting signature (status 'sent'). Asserting the legal PRIOR state blocks a
  // *signed* contract (which may already have a deposit invoice) from being
  // declined, and preserves idempotency: a re-tap matches no row and no-ops.
  if ((contract as { status?: string } | null)?.status !== "sent") return;

  const { data: updated, error } = await admin
    .from("contracts")
    .update({ status: "declined" })
    .eq("id", contractId)
    .eq("status", "sent")
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
