import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side event tracking for the activation funnel.
 *
 * Every insert routes through the service-role admin client. The event name is
 * validated against a fixed allowlist here — the single server-side chokepoint
 * shared by both the direct server-action path and the /api/track route — so
 * client callers cannot write arbitrary event names.
 *
 * This is fire-and-forget instrumentation: it must NEVER throw into a
 * user-facing request, action, or voice flow. Every failure is swallowed.
 */
export const TRACKED_EVENTS = [
  "signup_completed",
  "setup_started",
  "setup_completed",
  "voice_session_started",
  "voice_session_completed",
  "voice_session_failed",
  "voice_session_abandoned",
  "quote_drafted",
  "quote_sent",
  "quote_viewed",
  "quote_accepted",
  "quote_declined",
  "contract_sent",
  "contract_signed",
  "invoice_sent",
  "invoice_paid",
  "feedback_submitted",
] as const;

export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

const isTrackedEvent = (event: string): event is TrackedEvent =>
  (TRACKED_EVENTS as readonly string[]).includes(event);

export interface TrackContext {
  userId?: string | null;
  contractorId?: string | null;
  path?: string | null;
  sessionId?: string | null;
}

export const trackEvent = async (
  event: string,
  properties: Record<string, unknown> = {},
  context: TrackContext = {},
): Promise<void> => {
  try {
    if (!isTrackedEvent(event)) return;

    let userId = context.userId ?? null;
    if (userId === null) {
      try {
        const supabase = await createClient();
        const { data } = await supabase.auth.getUser();
        userId = data.user?.id ?? null;
      } catch {
        // No session in this context (e.g. webhook). Best-effort only.
      }
    }

    const admin = createAdminClient();
    await admin.from("events").insert({
      event,
      properties,
      user_id: userId,
      contractor_id: context.contractorId ?? null,
      path: context.path ?? null,
      session_id: context.sessionId ?? null,
    });
  } catch {
    // Instrumentation must never break the product.
  }
};
