import { describe, expect, it } from "vitest";
import { planManualReminder, canOfferManualReminder } from "@/lib/manual-reminder";
import {
  planChase,
  CHASE_WAVES,
  MAX_CONTACT_WAVES,
  type ChaseEventRow,
} from "@/lib/chase-plan";

/**
 * A manual reminder SPENDS a scheduled wave. It never adds one.
 *
 * chase-plan.ts states the customer-contact cap is unconditional — at most
 * MAX_CONTACT_WAVES distinct waves, "never exceeded, regardless of status".
 * Letting a contractor send on demand is the obvious way to break that, in
 * either direction: count the tap as a wave and a contractor can silence the
 * automated sequence early; don't count it and the cap stops being a cap.
 *
 * The design avoids both by firing the wave the cron WOULD have sent, early.
 * These tests hold the two halves that make that true, and they are written
 * against BOTH modules together on purpose — the property only exists because
 * the cron dedups on the same template this picks. Split across two files, one
 * could drift from the other and the cap would quietly start growing.
 */

const wave = (template: string, channel = "email"): ChaseEventRow => ({
  channel,
  template_used: template,
});

describe("a manual reminder consumes a scheduled wave", () => {
  it("picks the next unsent wave, not the one the calendar is due", () => {
    // One day overdue. The cron would send nothing (day 3 has not arrived), but
    // the wave it is holding is day_3 — so that is what a tap spends.
    const plan = planManualReminder([]);
    expect(plan).toEqual({
      action: "send",
      template: CHASE_WAVES[0].template,
      waveNumber: 1,
      wavesRemaining: MAX_CONTACT_WAVES - 1,
    });
  });

  it("walks the waves in order as they are spent", () => {
    const spent: ChaseEventRow[] = [];
    const templates: string[] = [];

    for (let i = 0; i < MAX_CONTACT_WAVES; i += 1) {
      const plan = planManualReminder(spent);
      if (plan.action !== "send") throw new Error(`expected a send at ${i}`);
      templates.push(plan.template);
      spent.push(wave(plan.template));
    }

    expect(templates).toEqual(CHASE_WAVES.map((w) => w.template));
  });

  it("NEVER invents a template the cron does not own", () => {
    // The load-bearing property. A manual send that produced a fifth,
    // manual-only template would grow the distinct-template set past the cap
    // while every individual check still passed.
    const known = new Set(CHASE_WAVES.map((w) => w.template));
    const spent: ChaseEventRow[] = [];

    for (let i = 0; i < MAX_CONTACT_WAVES; i += 1) {
      const plan = planManualReminder(spent);
      if (plan.action !== "send") throw new Error("expected a send");
      expect(known.has(plan.template)).toBe(true);
      spent.push(wave(plan.template));
    }
  });

  it("stops dead once every wave is spent", () => {
    const spent = CHASE_WAVES.map((w) => wave(w.template));
    expect(planManualReminder(spent)).toEqual({ action: "none", reason: "capped" });
  });

  it("counts a wave once however many channels carried it", () => {
    // The cap is on waves, not messages: an email and an SMS of the same
    // template are one contact.
    const spent = [wave("day_3", "email"), wave("day_3", "sms")];
    const plan = planManualReminder(spent);
    if (plan.action !== "send") throw new Error("expected a send");
    expect(plan.waveNumber).toBe(2);
  });

  it("does not count the cap marker as a wave", () => {
    // chase_events carries a non-contact 'cap' row. Counting it would silently
    // cost the customer a reminder.
    const spent = [wave("day_3"), { channel: "cap", template_used: "capped" }];
    const plan = planManualReminder(spent);
    if (plan.action !== "send") throw new Error("expected a send");
    expect(plan.template).toBe(CHASE_WAVES[1].template);
  });
});

describe("the cron then skips the wave that was brought forward", () => {
  it("plans the same template the manual send already recorded", () => {
    // This is the substitution, and it is the whole argument that the cap is
    // untouched. The contractor taps at 1 day overdue; day_3 goes out early.
    const manual = planManualReminder([]);
    if (manual.action !== "send") throw new Error("expected a send");

    const recorded = [wave(manual.template)];

    // Day 3 arrives. The cron plans a send — and it plans THIS template, which
    // its per-channel dedup (chase_events.channel + template_used, see
    // api/cron/chase/route.ts) then finds already present and skips.
    const due = new Date("2026-09-10T12:00:00Z");
    const cronPlan = planChase(
      due.toISOString(),
      recorded,
      due.getTime() + 3 * 86_400_000,
    );

    if (cronPlan.action !== "send") throw new Error("expected the cron to plan a send");
    expect(
      cronPlan.template,
      "if these ever differ, a manual reminder stops substituting and starts ADDING a contact",
    ).toBe(manual.template);
  });

  it("four taps exhaust the cron exactly as four cron waves would", () => {
    // Every wave spent by hand. The cron must now cap rather than find a fifth.
    const spent = CHASE_WAVES.map((w) => wave(w.template));
    const due = new Date("2026-09-01T12:00:00Z");

    expect(
      planChase(due.toISOString(), spent, due.getTime() + 60 * 86_400_000),
    ).toEqual({ action: "cap" });
  });
});

describe("the control is offered only where it makes sense", () => {
  it("is not offered before the invoice is overdue", () => {
    // The chase templates say the invoice is late. Offering this on a
    // same-day invoice invites a trade to chase a customer who is not.
    expect(canOfferManualReminder({ overdue: false, events: [] })).toBe(false);
  });

  it("is offered once overdue with waves left", () => {
    expect(canOfferManualReminder({ overdue: true, events: [] })).toBe(true);
  });

  it("is withdrawn once the cap is spent", () => {
    // Not disabled — gone. The cap already promises we stop contacting them
    // and chasing becomes the trade's own; the copy-payment-link route beside
    // it is what remains.
    const spent = CHASE_WAVES.map((w) => wave(w.template));
    expect(canOfferManualReminder({ overdue: true, events: spent })).toBe(false);
  });
});
