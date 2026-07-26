// Pure chase-schedule planner — decides, for a single unpaid invoice, whether a
// reminder wave is due, or whether the hard contact cap has been reached. Kept
// I/O-free so the cap logic is unit-tested without a database; the chase cron
// loads the rows, calls this, then sends + records the resulting plan.
//
// The cap is UNCONDITIONAL: a customer receives at most MAX_CONTACT_WAVES
// distinct reminder waves (3-, 7-, 14-day, then one final), after which we stop
// contacting them permanently and notify the trade instead. A wave may go out
// on both email and SMS, but that still counts as ONE wave — the cap is on
// waves (attempts), not individual messages.

import { daysOverdue as londonDaysOverdue } from "@/lib/overdue";

export type ChaseWave = { day: number; template: string };

// The four reminder waves, by days overdue. The final wave closes the sequence.
export const CHASE_WAVES: ChaseWave[] = [
  { day: 3, template: "day_3" },
  { day: 7, template: "day_7" },
  { day: 14, template: "day_14" },
  { day: 21, template: "final" },
];

// Hard cap on customer-contact waves. Never exceeded, regardless of status.
export const MAX_CONTACT_WAVES = CHASE_WAVES.length;

// The marker row written to chase_events exactly once when the cap is hit. It's
// not a customer contact — it silences all future chasing and lets the timeline
// render "Reminders stopped after N attempts". `channel` is free text on
// chase_events, so this needs no schema change.
export const CHASE_CAP_CHANNEL = "cap";
export const CHASE_CAP_TEMPLATE = "capped";

export type ChaseEventRow = { channel: string; template_used: string | null };

export type ChasePlan =
  // Nothing to do: not overdue enough yet, or the cap is already recorded.
  | { action: "none" }
  // A wave is due — the cron still applies per-channel dedup before sending.
  | { action: "send"; template: string; daysOverdue: number }
  // The cap has just been reached and its marker isn't recorded yet: record it
  // and notify the trade, then never contact the customer again.
  | { action: "cap" };

// Distinct customer-contact waves already sent. Only email/sms rows count — the
// cap marker (and any other non-contact row) is never a wave.
const wavesSent = (events: ChaseEventRow[]): Set<string | null> =>
  new Set(
    events
      .filter((e) => e.channel === "email" || e.channel === "sms")
      .map((e) => e.template_used),
  );

export const planChase = (
  dueDate: string | null,
  chaseEvents: ChaseEventRow[],
  now: number,
): ChasePlan => {
  if (!dueDate) return { action: "none" };
  // London calendar days, end-of-day — see @/lib/overdue. Keeps the cron, the
  // job page and the dashboard agreeing on "how overdue" to the day, and stops
  // a UTC-midnight instant flagging a customer a day early around BST/GMT.
  const daysOverdue = londonDaysOverdue(dueDate, now);

  const sent = wavesSent(chaseEvents);
  const capRecorded = chaseEvents.some((e) => e.channel === CHASE_CAP_CHANNEL);

  // Unconditional cap: once the max distinct waves have gone out, stop forever.
  // Emit a one-time cap action so the caller records the marker + nudges the
  // trade; thereafter it's a no-op.
  if (sent.size >= MAX_CONTACT_WAVES) {
    return capRecorded ? { action: "none" } : { action: "cap" };
  }

  // Otherwise the current wave is the furthest one whose day has passed.
  const wave = [...CHASE_WAVES].reverse().find((w) => daysOverdue >= w.day);
  if (!wave) return { action: "none" };
  return { action: "send", template: wave.template, daysOverdue };
};
