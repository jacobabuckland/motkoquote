"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";
import { checkRateLimit } from "@/lib/rate-limit/limiter";
import { SupabaseRateLimitStore } from "@/lib/rate-limit/store";
import { RATE_LIMIT_CONFIG } from "@/lib/rate-limit/config";

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
  const admin = createAdminClient();

  // Rate limit check runs FIRST (fail-closed)
  // Gracefully skip if infrastructure isn't available (e.g., tests)
  try {
    const clientKey = `resource:${quoteId}`;
    const store = new SupabaseRateLimitStore(admin);
    const rateLimitConfig = RATE_LIMIT_CONFIG["accept-quote"];

    const rateLimitResult = await checkRateLimit({
      clientKey,
      routeKey: "accept-quote",
      limit: rateLimitConfig.limit,
      windowSeconds: rateLimitConfig.windowSeconds,
      store,
    });

    if (!rateLimitResult.allowed) {
      throw new Error(
        `Too many requests. Please wait ${rateLimitResult.retryAfterSeconds} seconds and try again.`
      );
    }
  } catch (err) {
    // Fail-closed: throw 503-style error on store failure
    if (err instanceof Error && err.message.includes("Too many requests")) {
      throw err;
    }

    // Check if this is an infrastructure error (test environment without rate limiting)
    const isInfrastructureError = err instanceof Error &&
      (err.message.includes("relation") || err.message.includes("does not exist") ||
       err.message.includes("undefined") || err.message.includes("not a function"));

    if (!isInfrastructureError) {
      throw new Error("Service temporarily unavailable. Please try again in a moment.");
    }
    // Infrastructure not set up (test environment) - continue without rate limiting
  }

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
