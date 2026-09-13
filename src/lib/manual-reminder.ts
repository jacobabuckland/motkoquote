import {
  CHASE_WAVES,
  MAX_CONTACT_WAVES,
  wavesSent,
  type ChaseEventRow,
} from "@/lib/chase-plan";

/**
 * "Send a reminder now" — the contractor brings the next scheduled wave
 * FORWARD. It never adds one.
 *
 * WHY IT IS SHAPED THIS WAY, which is the whole of the design.
 * chase-plan.ts states the cap is unconditional: a customer receives at most
 * MAX_CONTACT_WAVES distinct reminder waves, "never exceeded, regardless of
 * status". A manual send is a customer contact, so it has to either count as a
 * wave — and a contractor tap could then silence the automated sequence early —
 * or not count, which ends the cap being unconditional. Neither is acceptable.
 *
 * The third option is what this does: the manual send fires the next wave the
 * cron WOULD have sent, early. The set of distinct templates still tops out at
 * four, so the cap is untouched — and the cron then skips that wave when its
 * day arrives, because its per-channel dedup is keyed on exactly this template
 * (`chase_events.template_used`, see api/cron/chase/route.ts). So the sequence
 * shifts earlier rather than growing.
 *
 * That dedup is load-bearing. If the cron ever stops keying on template_used,
 * a manual send stops substituting and starts adding, which is the one outcome
 * this design exists to prevent. tests/regression/a-manual-reminder-spends-a-
 * -wave.test.ts pins both halves together for that reason.
 */
export type ManualReminderPlan =
  | {
      action: "send";
      /** The wave being brought forward — a template the cron also owns. */
      template: string;
      /** 1-based, for the contractor-facing "2nd of 4" count. */
      waveNumber: number;
      /** How many remain AFTER this one goes out. */
      wavesRemaining: number;
    }
  // Every wave is spent. We have stopped contacting this customer by design,
  // and a manual tap does not get to reopen it — the trade takes over, which is
  // what the cap already tells them happens.
  | { action: "none"; reason: "capped" };

export const planManualReminder = (events: ChaseEventRow[]): ManualReminderPlan => {
  const sent = wavesSent(events);

  // The FIRST unsent wave, not the one the calendar is due. That is what makes
  // this a bring-forward: at 1 day overdue the next wave is still day_3, so
  // sending it now consumes day_3 rather than inventing a fifth template.
  const next = CHASE_WAVES.find((wave) => !sent.has(wave.template));
  if (!next) return { action: "none", reason: "capped" };

  return {
    action: "send",
    template: next.template,
    waveNumber: sent.size + 1,
    wavesRemaining: MAX_CONTACT_WAVES - sent.size - 1,
  };
};

/**
 * Whether to offer the control at all. Overdue only — the chase templates say
 * the invoice is late, and a control inviting a trade to chase a customer who
 * is not late is wrong on the copy and wrong on the relationship.
 *
 * This is a HINT for the page. The server action re-derives the cap job-wide
 * and refuses on its own authority; a stale page must never be able to spend a
 * wave that is not there.
 */
export const canOfferManualReminder = ({
  overdue,
  events,
}: {
  overdue: boolean;
  events: ChaseEventRow[];
}): boolean => overdue && planManualReminder(events).action === "send";
