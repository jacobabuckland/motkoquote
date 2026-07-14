"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyContractorOfCustomerAction } from "@/lib/notify-contractor";

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
  const { error } = await admin
    .from("quotes")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", quoteId);

  if (error) throw new Error(error.message);

  const job = await loadQuoteJob(admin, quoteId);
  if (job) {
    await notifyContractorOfCustomerAction(admin, {
      jobId: job.jobId,
      subject: `${job.customerName} accepted your quote`,
      heading: `${job.customerName} accepted your quote.`,
      nextStep: "Next step: send them a contract to sign.",
    });
  }
};

export const declineQuote = async (quoteId: string) => {
  const admin = createAdminClient();
  const { error } = await admin
    .from("quotes")
    .update({ status: "declined", declined_at: new Date().toISOString() })
    .eq("id", quoteId);

  if (error) throw new Error(error.message);

  const job = await loadQuoteJob(admin, quoteId);
  if (job) {
    await notifyContractorOfCustomerAction(admin, {
      jobId: job.jobId,
      subject: `${job.customerName} declined your quote`,
      heading: `${job.customerName} declined your quote.`,
      nextStep: "Nothing needs you here — start a new quote if things change.",
    });
  }
};
