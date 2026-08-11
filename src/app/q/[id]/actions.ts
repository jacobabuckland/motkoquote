"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";
import { checkRateLimits, getRateLimitConfig } from "@/lib/rate-limit";
import { getClientIpFromHeaders } from "@/lib/get-client-ip";

type QuoteJobRow = {
  job_id: string;
  job: { customer: { name: string } | null } | null;
};

const loadQuoteJob = async (
  admin: ReturnType<typeof createAdminClient>,
  quoteId: string,
): Promise<{ jobId: string; customerName: string } | null> => {
  const { data } = await admin
    .from("quotes")
    .select("job_id, job:jobs(customer:customers(name))")
    .eq("id", quoteId)
    .maybeSingle();

  const row = data as unknown as QuoteJobRow | null;
  if (!row?.job_id) return null;
  return { jobId: row.job_id, customerName: row.job?.customer?.name ?? "Your customer" };
};

export const acceptQuote = async (quoteId: string) => {
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
    checks.push({ key: `customer-action:resource:${quoteId}`, config: resourceConfig });
  }

  if (checks.length > 0) {
    const limitResult = await checkRateLimits(checks, { skipAuth: isServiceCaller });
    if (!limitResult.allowed) {
      throw new Error(`Too many requests. Please try again in ${limitResult.retryAfter} seconds.`);
    }
  }

  const admin = createAdminClient();
  // State-machine guard: a quote may only be accepted while it is still awaiting
  // a decision (status 'sent'). Asserting the legal PRIOR state — not merely
  // "not already accepted" — blocks a *declined* quote from being flipped to
  // accepted, and preserves idempotency: a re-tap matches no row and no-ops.
  const { data: updated, error } = await admin
    .from("quotes")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("status", "sent")
    .select("id");

  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) return;

  const job = await loadQuoteJob(admin, quoteId);
  if (job) {
    await notifyContractorOfCustomerAction(admin, {
      jobId: job.jobId,
      event: "quote_accepted",
      subject: `${job.customerName} accepted your quote`,
      heading: `${job.customerName} accepted your quote.`,
      nextStep: "Next step: send them a contract to sign.",
    });
  }
};

export const declineQuote = async (quoteId: string) => {
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
    checks.push({ key: `customer-action:resource:${quoteId}`, config: resourceConfig });
  }

  if (checks.length > 0) {
    const limitResult = await checkRateLimits(checks, { skipAuth: isServiceCaller });
    if (!limitResult.allowed) {
      throw new Error(`Too many requests. Please try again in ${limitResult.retryAfter} seconds.`);
    }
  }

  const admin = createAdminClient();
  // State-machine guard: a quote may only be declined while it is still awaiting
  // a decision (status 'sent'). Asserting the legal PRIOR state blocks an
  // *accepted* quote from being flipped to declined, and preserves idempotency:
  // a re-tap matches no row and no-ops.
  const { data: updated, error } = await admin
    .from("quotes")
    .update({ status: "declined", declined_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("status", "sent")
    .select("id");

  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) return;

  const job = await loadQuoteJob(admin, quoteId);
  if (job) {
    await notifyContractorOfCustomerAction(admin, {
      jobId: job.jobId,
      event: "quote_declined",
      subject: `${job.customerName} declined your quote`,
      heading: `${job.customerName} declined your quote.`,
      nextStep: "Nothing needs you here — start a new quote if things change.",
    });
  }
};
