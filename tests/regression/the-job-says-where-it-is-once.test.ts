import { describe, expect, it } from "vitest";
import { buildJobTimeline } from "@/lib/job-timeline";
import { buildStatusPanel } from "@/lib/job-status-panel";
import type { Stage, StageKey, StageState } from "@/lib/job-stages";

/**
 * A job page says where it has got to ONCE, and the timeline a contractor
 * reads is not the same shape as the machine that decides it.
 *
 * The machine keeps six keys because eleven frozen acceptance tests depend on
 * them and because "accepted but not signed" is a real state it has to reason
 * about. The timeline shows five rows because that is how many moments a job
 * has to the person looking at it. This is the mapping between the two, and
 * the thing that must never happen is a SECOND answer being computed — the
 * chip and the timeline both still come from one `deriveSituation` call.
 */

const stagesOf = (states: Partial<Record<StageKey, StageState>>): Stage[] =>
  (
    ["quote_sent", "accepted", "contract_signed", "work_complete", "invoiced", "paid"] as StageKey[]
  ).map((key) => ({
    key,
    label: key,
    state: states[key] ?? "future",
    date: states[key] === "complete" ? "2026-08-19T10:00:00Z" : null,
  }));

const build = (
  states: Partial<Record<StageKey, StageState>>,
  extra: Partial<Parameters<typeof buildJobTimeline>[0]> = {},
) =>
  buildJobTimeline({
    stages: stagesOf(states),
    move: "customer",
    customerFirstName: "Megan",
    capturedAt: "2026-08-18T09:00:00Z",
    ...extra,
  });

describe("five rows, from six stages", () => {
  it("always shows the five moments a job has", () => {
    expect(build({}).map((r) => r.label)).toEqual([
      "Job captured",
      "Quote sent",
      "Accepted & signed",
      "Invoiced",
      "Paid",
    ]);
  });

  it("starts where the contractor thinks the job started", () => {
    // "Job captured" has no stage behind it: if there is a job to look at, it
    // was captured. Without it the timeline opens on "Quote sent", which is
    // the first thing the SYSTEM stored, not the first thing that happened.
    const [first] = build({});
    expect(first.state).toBe("complete");
    expect(first.date).toBe("2026-08-18T09:00:00Z");
  });

  it("only calls the merged row done when BOTH halves are", () => {
    // Accepted-but-unsigned reading as "Accepted & signed ✓" would be the
    // timeline telling the contractor a contract is in that is not.
    const half = build({ quote_sent: "complete", accepted: "complete", contract_signed: "current" });
    expect(half.find((r) => r.key === "accepted_signed")?.state).toBe("current");

    const both = build({ quote_sent: "complete", accepted: "complete", contract_signed: "complete" });
    expect(both.find((r) => r.key === "accepted_signed")?.state).toBe("complete");
  });

  it("carries the moment the merged pair STARTED", () => {
    const rows = buildJobTimeline({
      stages: [
        { key: "accepted", label: "", state: "complete", date: "2026-08-19T10:00:00Z" },
        { key: "contract_signed", label: "", state: "complete", date: "2026-08-21T10:00:00Z" },
      ],
      move: "none",
      customerFirstName: "Megan",
      capturedAt: null,
    });
    expect(rows.find((r) => r.key === "accepted_signed")?.date).toBe("2026-08-19T10:00:00Z");
  });

  it("shows a stopped pipeline as stopped", () => {
    const rows = build({ quote_sent: "complete", accepted: "declined" });
    expect(rows.find((r) => r.key === "accepted_signed")?.state).toBe("declined");
  });
});

describe("the open row says what it is waiting for, not a date it hasn't got", () => {
  it("names the customer when it is their move", () => {
    const rows = build({ quote_sent: "complete", accepted: "complete", contract_signed: "complete", invoiced: "complete", paid: "current" }, { move: "customer" });
    expect(rows.find((r) => r.key === "paid")?.requirement).toBe("With Megan");
  });

  it("says so plainly when it is the contractor's", () => {
    const rows = build({ quote_sent: "current" }, { move: "contractor" });
    expect(rows.find((r) => r.key === "quote_sent")?.requirement).toBe("Your move");
  });

  it("overdue outranks whose move it is — late is late", () => {
    const rows = build({ quote_sent: "complete", invoiced: "complete", paid: "current" }, { move: "customer", overdue: true });
    expect(rows.find((r) => r.key === "paid")?.requirement).toBe("Due now");
  });

  it("puts the requirement on exactly one row", () => {
    const rows = build({ quote_sent: "current" }, { move: "contractor" });
    expect(rows.filter((r) => r.requirement !== null)).toHaveLength(1);
  });

  it("asks for nothing once the job is settled", () => {
    const rows = build(
      { quote_sent: "complete", accepted: "complete", contract_signed: "complete", invoiced: "complete", paid: "complete" },
      { move: "none" },
    );
    expect(rows.every((r) => r.requirement === null)).toBe(true);
  });
});

describe("the status panel is tinted by whose move it is", () => {
  const panel = (situation: Parameters<typeof buildStatusPanel>[0]["situation"], move: Parameters<typeof buildStatusPanel>[0]["move"]) =>
    buildStatusPanel({ situation, move, firstName: "Megan" });

  it("is amber when the contractor owes an action", () => {
    expect(panel("draft_quote", "contractor").tone).toBe("amber");
    expect(panel("signed_need_invoice", "contractor").tone).toBe("amber");
  });

  it("stays QUIET when the job is waiting on someone else", () => {
    // The rule the whole palette hangs off. A contractor scans for what they
    // have to do; a screen that shouts about things they cannot act on
    // teaches them to stop reading it.
    expect(panel("quote_sent", "customer").tone).toBe("neutral");
    expect(panel("invoice_unpaid", "customer").tone).toBe("neutral");
  });

  it("is green only when the job is done", () => {
    expect(panel("paid", "none").tone).toBe("green");
  });

  it("is amber when payment is overdue, whoever is holding it", () => {
    expect(panel("invoice_overdue", "customer").tone).toBe("amber");
  });

  it("is red at a dead end", () => {
    expect(panel("quote_declined", "none").tone).toBe("red");
    expect(panel("contract_declined", "none").tone).toBe("red");
  });

  it("lets a just-sent message take the headline", () => {
    // More specific than "waiting on Megan" at that moment, and it is what the
    // green banner this panel replaces used to say.
    const p = buildStatusPanel({
      situation: "invoice_unpaid",
      move: "customer",
      firstName: "Megan",
      sentTitle: "Invoice sent today",
      sentBody: "Nothing needs you.",
    });
    expect(p.headline).toBe("Invoice sent today");
    expect(p.detail).toBe("Nothing needs you.");
  });

  it("falls back to the situation when there was no send", () => {
    expect(panel("invoice_unpaid", "customer").headline).toBe("Waiting on Megan to pay");
    expect(panel("invoice_unpaid", "customer").detail).toBe(
      "We'll email you the moment Megan pays.",
    );
  });
});
