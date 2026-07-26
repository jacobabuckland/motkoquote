import { describe, expect, it } from "vitest";
import {
  planChase,
  MAX_CONTACT_WAVES,
  CHASE_CAP_CHANNEL,
  CHASE_CAP_TEMPLATE,
  type ChaseEventRow,
} from "@/lib/chase-plan";

const DAY = 86_400_000;
// A due date, and a "now" a given number of days past it.
const DUE = "2026-06-01T00:00:00.000Z";
const overdue = (days: number) => new Date(DUE).getTime() + days * DAY;

const sent = (template: string, channel = "email"): ChaseEventRow => ({
  channel,
  template_used: template,
});

describe("planChase — wave selection", () => {
  it("does nothing before the first wave is due", () => {
    expect(planChase(DUE, [], overdue(2))).toEqual({ action: "none" });
  });

  it("does nothing when there is no due date", () => {
    expect(planChase(null, [], overdue(30))).toEqual({ action: "none" });
  });

  it("sends the day_3 wave once 3 days overdue", () => {
    expect(planChase(DUE, [], overdue(3))).toEqual({
      action: "send",
      template: "day_3",
      daysOverdue: 3,
    });
  });

  it("picks the furthest passed wave (14 days => day_14)", () => {
    const plan = planChase(DUE, [], overdue(15));
    expect(plan).toMatchObject({ action: "send", template: "day_14" });
  });

  it("sends the final wave at 21 days overdue", () => {
    const plan = planChase(DUE, [], overdue(25));
    expect(plan).toMatchObject({ action: "send", template: "final" });
  });
});

describe("planChase — unconditional cap", () => {
  const allFour = [sent("day_3"), sent("day_7"), sent("day_14"), sent("final")];

  it("caps after the maximum number of distinct waves", () => {
    expect(allFour).toHaveLength(MAX_CONTACT_WAVES);
    expect(planChase(DUE, allFour, overdue(40))).toEqual({ action: "cap" });
  });

  it("counts an email+sms of the same wave as ONE wave (not yet capped)", () => {
    const events = [
      sent("day_3", "email"),
      sent("day_3", "sms"),
      sent("day_7", "email"),
      sent("day_7", "sms"),
      sent("day_14", "email"),
    ];
    // Three distinct waves despite five messages — still one short of the cap.
    const plan = planChase(DUE, events, overdue(40));
    expect(plan).toMatchObject({ action: "send", template: "final" });
  });

  it("records the cap only once — after the marker exists it's a no-op", () => {
    const capped = [
      ...allFour,
      { channel: CHASE_CAP_CHANNEL, template_used: CHASE_CAP_TEMPLATE },
    ];
    expect(planChase(DUE, capped, overdue(40))).toEqual({ action: "none" });
  });

  it("ignores the cap marker when counting waves", () => {
    const events = [
      sent("day_3"),
      sent("day_7"),
      { channel: CHASE_CAP_CHANNEL, template_used: CHASE_CAP_TEMPLATE },
    ];
    // Cap marker is not a wave, so only two waves count => below the cap, still
    // sending (the furthest passed wave; the cron applies per-channel dedup).
    expect(planChase(DUE, events, overdue(40))).toMatchObject({ action: "send" });
  });
});
