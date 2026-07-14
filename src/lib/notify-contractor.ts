import type { SupabaseClient } from "@supabase/supabase-js";
import { sendContractorNotificationEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import type { NotificationEvent } from "@/lib/schemas/notification";

type NotifyInput = {
  jobId: string;
  event: NotificationEvent;
  subject: string;
  heading: string;
  nextStep: string;
};

// Fires the contractor-facing notification for a customer action (quote
// accepted/declined, contract signed/declined, invoice paid). Looks up the
// contractor's business email and owner user off the job, then delivers on
// every channel they have: an email plus a push to each registered device.
// Both always deep-link back to the job hub so the next step is one tap away.
// Best-effort: a missing email/subscription or a delivery failure never throws,
// so the underlying customer flow (signing, paying) is never blocked.
export const notifyContractorOfCustomerAction = async (
  admin: SupabaseClient,
  input: NotifyInput,
): Promise<void> => {
  const { data: job } = await admin
    .from("jobs")
    .select("contractor:contractors(owner_user_id, business_profile)")
    .eq("id", input.jobId)
    .maybeSingle();

  const contractor = job?.contractor as unknown as {
    owner_user_id: string | null;
    business_profile: { business_email?: string | null } | null;
  } | null;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const jobUrl = `${appUrl}/jobs/${input.jobId}`;

  const to = contractor?.business_profile?.business_email;
  if (to) {
    await sendContractorNotificationEmail({
      to,
      subject: input.subject,
      heading: input.heading,
      nextStep: input.nextStep,
      jobUrl,
    });
  }

  const ownerUserId = contractor?.owner_user_id;
  if (ownerUserId) {
    await sendPushToUser(admin, ownerUserId, {
      event: input.event,
      title: input.heading,
      body: input.nextStep,
      url: jobUrl,
    });
  }
};
