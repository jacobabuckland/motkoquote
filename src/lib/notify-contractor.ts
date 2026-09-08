import type { SupabaseClient } from "@supabase/supabase-js";
import { sendContractorNotificationEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { track } from "@/lib/analytics";
import type { NotificationEvent } from "@/lib/schemas/notification";

type NotifyInput = {
  jobId: string;
  event: NotificationEvent;
  subject: string;
  heading: string;
  nextStep: string;
};

/** What actually happened, per channel. */
export type NotifyOutcome = {
  email: "delivered" | "failed" | "no_address";
  push: "delivered" | "failed" | "no_devices";
};

// The event name every delivery attempt is recorded under. One name, so "did
// this trade ever get told?" is a single query rather than an archaeology
// exercise across three log surfaces.
export const NOTIFICATION_DELIVERY_EVENT = "notification_delivery";

/**
 * Tells the contractor a customer did something. Never throws. Always records.
 *
 * WHY THIS IS TOTAL. This runs AFTER the database write in five flows — the
 * customer's first view of a quote, quote accept, contract sign, mark-as-paid,
 * and the push fan-out behind all of them. On 8 Sep 2026 a malformed
 * APNS_PRIVATE_KEY made signing throw, and because nothing here caught it the
 * exception escaped the whole server action. The customer was told their action
 * failed when it had already committed; the retry only "worked" because a state
 * guard skipped the notification the second time round. Four separate defects
 * were reported before anyone noticed they were one.
 *
 * The docblock here used to claim "a delivery failure never throws" while the
 * function contained no try/catch at all. That is the shape of the bug — a
 * promise made in a comment and enforced nowhere — so the guarantee is now
 * structural: every channel is wrapped, and the function returns an outcome
 * instead of relying on the absence of an exception to mean success.
 *
 * WHY IT RECORDS. Wrapping alone converts a loud failure into a silent one,
 * which for a trade whose quote was accepted is worse: they simply never learn.
 * So each channel's result is written to `events`. That is not a retry queue and
 * not a UI — it is the record that makes the failure answerable, and the history
 * a real outbox can be built on later. Decision 8 Sep 2026 (Jacob), option (a):
 * status ships with the wrap as a hard condition; the outbox follows.
 * See areas/motko.md.
 *
 * The daily count of failures is surfaced by the chase cron, so this does not
 * terminate in a table nobody opens.
 */
export const notifyContractorOfCustomerAction = async (
  admin: SupabaseClient,
  input: NotifyInput,
): Promise<NotifyOutcome> => {
  const outcome: NotifyOutcome = { email: "no_address", push: "no_devices" };

  // Even the lookup is guarded. It is a network call on the same path, and a
  // failure to find out who to notify must not become a failed settlement.
  type NotifiableContractor = {
    owner_user_id: string | null;
    business_profile: { business_email?: string | null } | null;
  };
  let contractor: NotifiableContractor | null = null;

  try {
    const { data: job } = await admin
      .from("jobs")
      .select("contractor:contractors(owner_user_id, business_profile)")
      .eq("id", input.jobId)
      .maybeSingle();
    contractor = (job?.contractor ?? null) as NotifiableContractor | null;
  } catch (err) {
    console.error(`[notify] could not load contractor for job ${input.jobId}`, err);
    await recordDelivery(input, { email: "failed", push: "failed" });
    return { email: "failed", push: "failed" };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const jobUrl = `${appUrl}/jobs/${input.jobId}`;

  const to = contractor?.business_profile?.business_email;
  if (to) {
    try {
      const { delivered } = await sendContractorNotificationEmail({
        to,
        subject: input.subject,
        heading: input.heading,
        nextStep: input.nextStep,
        jobUrl,
      });
      outcome.email = delivered ? "delivered" : "failed";
    } catch (err) {
      // sendContractorNotificationEmail is itself total now, so this is
      // belt-and-braces — and it is the belt that was missing in September.
      console.error(`[notify] email threw for job ${input.jobId}`, err);
      outcome.email = "failed";
    }
  }

  const ownerUserId = contractor?.owner_user_id;
  if (ownerUserId) {
    try {
      const summary = await sendPushToUser(admin, ownerUserId, {
        event: input.event,
        title: input.heading,
        body: input.nextStep,
        url: jobUrl,
      });
      outcome.push =
        summary.devices === 0 ? "no_devices" : summary.sent > 0 ? "delivered" : "failed";
    } catch (err) {
      console.error(`[notify] push threw for job ${input.jobId}`, err);
      outcome.push = "failed";
    }
  }

  await recordDelivery(input, outcome);
  return outcome;
};

/**
 * Writes one row per notification attempt.
 *
 * Uses `track`, which is already bounded by a timeout and swallows its own
 * failures — the properties it needs are exactly what makes this queryable
 * without carrying anything sensitive. Note what is NOT stored: no email
 * address, no device token. The contractor is identified by job, which is
 * enough to answer the question and nothing more.
 */
const recordDelivery = async (input: NotifyInput, outcome: NotifyOutcome): Promise<void> => {
  await track(
    NOTIFICATION_DELIVERY_EVENT,
    {
      notification_event: input.event,
      job_id: input.jobId,
      email: outcome.email,
      push: outcome.push,
      // The one field the daily signal filters on, so a count does not have to
      // reason about the two channels separately.
      failed: outcome.email === "failed" || outcome.push === "failed",
    },
    { allowAnonymous: true },
  );
};
