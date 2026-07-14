import type { SupabaseClient } from "@supabase/supabase-js";
import { sendContractorNotificationEmail } from "@/lib/email";

type NotifyInput = {
  jobId: string;
  subject: string;
  heading: string;
  nextStep: string;
};

// Fires the contractor-facing notification for a customer action (quote
// accepted/declined, contract signed/declined, invoice paid). Looks up the
// contractor's business email off the job, and always deep-links back to the
// job hub via an "Open the job" button so the next step is one tap away.
// Best-effort: a missing email or a delivery failure never throws, so the
// underlying customer flow (signing, paying) is never blocked by email.
export const notifyContractorOfCustomerAction = async (
  admin: SupabaseClient,
  input: NotifyInput,
): Promise<void> => {
  const { data: job } = await admin
    .from("jobs")
    .select("contractor:contractors(business_profile)")
    .eq("id", input.jobId)
    .maybeSingle();

  const contractor = job?.contractor as unknown as {
    business_profile: { business_email?: string | null } | null;
  } | null;
  const to = contractor?.business_profile?.business_email;
  if (!to) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  await sendContractorNotificationEmail({
    to,
    subject: input.subject,
    heading: input.heading,
    nextStep: input.nextStep,
    jobUrl: `${appUrl}/jobs/${input.jobId}`,
  });
};
