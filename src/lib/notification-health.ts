// The daily "are notifications actually arriving?" signal.
//
// Making the notifiers non-throwing (P0-2) removes a loud failure. That is the
// right trade — a trade's quote acceptance must not fail because a push did —
// but on its own it replaces a wrong answer with silence, and for the trade who
// never learns their quote was accepted, silence is worse. So every attempt is
// recorded, and this reads those records once a day.
//
// TWO PROPERTIES, and the second is the one that is usually missed.
//
//   1. It reports failures. Non-zero count -> one email.
//   2. It proves it is still running. A cron that dies produces no email, which
//      is indistinguishable from "nothing failed" — the monitor fails the same
//      way the thing it monitors did. So a heartbeat goes out on Mondays
//      whatever the count, and a health row is written on EVERY run: "no row
//      today" is then a fact rather than an absence.
//
// This repo already contains the counter-example. `/api/cron/report-off-rails-
// invoices` is authenticated, works, and returns a tidy JSON report — and is not
// in vercel.json, so nothing has ever called it and its output has reached
// nobody since the day it shipped. A report that is not delivered is not a
// report. Hence: piggy-backed on the chase cron, which is already scheduled,
// already authenticated, and already runs daily.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendContractorNotificationEmail } from "@/lib/email";
import { NOTIFICATION_DELIVERY_EVENT } from "@/lib/notify-contractor";

/** Written on every run, so a missing row means the cron stopped. */
export const NOTIFICATION_HEALTH_EVENT = "notification_health";

export type NotificationHealth = {
  windowHours: number;
  attempts: number;
  failed: number;
  /** True when an email went out — a failure report or the weekly heartbeat. */
  reported: boolean;
};

const WINDOW_HOURS = 24;

/** Monday. Picked so the heartbeat lands at the start of a working week. */
const isHeartbeatDay = (now: Date): boolean => now.getUTCDay() === 1;

/**
 * Counts the last day's notification attempts, records the count, and emails
 * when there is something to say.
 *
 * Total by construction: this runs inside the chase cron, and a monitoring
 * problem must never take down the thing it monitors. Every failure path
 * returns a health object rather than throwing.
 */
export const reportNotificationHealth = async (
  admin: SupabaseClient,
  operatorEmail: string | undefined,
  now: Date = new Date(),
): Promise<NotificationHealth> => {
  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000).toISOString();
  const health: NotificationHealth = {
    windowHours: WINDOW_HOURS,
    attempts: 0,
    failed: 0,
    reported: false,
  };

  try {
    const { data: rows } = await admin
      .from("events")
      .select("properties")
      .eq("event_name", NOTIFICATION_DELIVERY_EVENT)
      .gte("created_at", since);

    const attempts = (rows ?? []) as { properties: { failed?: boolean } | null }[];
    health.attempts = attempts.length;
    health.failed = attempts.filter((row) => row.properties?.failed === true).length;
  } catch (err) {
    console.error("[notification-health] could not count attempts", err);
    // Fall through: the health row below still records that the check ran, which
    // is the difference between "nothing failed" and "we could not look".
  }

  const heartbeat = isHeartbeatDay(now);
  if (operatorEmail && (health.failed > 0 || heartbeat)) {
    const subject =
      health.failed > 0
        ? `${health.failed} notification${health.failed === 1 ? "" : "s"} failed to reach a trade`
        : "Notification delivery: all clear this week";
    try {
      const { delivered } = await sendContractorNotificationEmail({
        to: operatorEmail,
        subject,
        heading:
          health.failed > 0
            ? `${health.failed} of ${health.attempts} notification attempts failed in the last ${WINDOW_HOURS} hours.`
            : `All ${health.attempts} notification attempts in the last ${WINDOW_HOURS} hours were delivered.`,
        nextStep:
          health.failed > 0
            ? "Check the APNs and Resend configuration, then query events for notification_delivery rows where properties->>'failed' = 'true'."
            : "Nothing to do. This weekly note exists so silence from this alert can be told apart from the cron having stopped.",
        jobUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard`,
      });
      health.reported = delivered;
    } catch (err) {
      console.error("[notification-health] could not send the report", err);
    }
  }

  try {
    await admin.from("events").insert({
      user_id: null,
      event_name: NOTIFICATION_HEALTH_EVENT,
      properties: { ...health, heartbeat },
    });
  } catch (err) {
    console.error("[notification-health] could not write the health row", err);
  }

  return health;
};
