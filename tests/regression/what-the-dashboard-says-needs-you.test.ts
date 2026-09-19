// 19 SEP, from a browser walk of the dashboard. Two claims the product makes
// about a job's state, both of them false at the moment they are read.
//
// 1. "Your move 18" counted eighteen drafts, every card reading "Untitled
//    quote / started today", every one offering Archive and nothing else.
//    "Type the quote in instead" inserts the draft the instant it is clicked
//    (jobs/new/page.tsx startManual), so every abandoned tap leaves a row, and
//    the badge that tells a contractor what needs them counted all of it.
//
// 2. The job banner carried a green "✓ Work complete" chip with "Mark the work
//    complete, then invoice" in amber thirty pixels beneath it, and the
//    activity log confirming the work was marked complete the day before. The
//    `work_complete` situation is reached ONLY when `workCompletedAt` is set
//    (job-stages.ts:344) — the headline was left over from the state before it.
import { describe, expect, it } from "vitest";
import { isEmptyDraft } from "@/lib/uninvoiced-balance";
import { buildStatusPanel } from "@/lib/job-status-panel";

const draft = (total: number, customerName: string | null) => ({
  total,
  job: customerName === null ? null : { customer: { name: customerName } },
});

describe("a draft the contractor never entered anything into", () => {
  it("is not work waiting on them", () => {
    expect(isEmptyDraft(draft(0, null))).toBe(true);
  });

  it("is still empty when the job row exists but carries no customer", () => {
    expect(isEmptyDraft({ total: 0, job: { customer: null } })).toBe(true);
  });

  it("treats a whitespace-only customer name as no name", () => {
    expect(isEmptyDraft(draft(0, "   "))).toBe(true);
  });

  it("copes with a null total", () => {
    expect(isEmptyDraft({ total: null, job: null })).toBe(true);
  });
});

describe("what must keep counting", () => {
  // NARROW ON PURPOSE. Half-finished is still the contractor's to finish; only
  // the both-empty case can exist without them entering anything at all.
  it("a named customer with no lines yet", () => {
    expect(isEmptyDraft(draft(0, "Megan Farrant"))).toBe(false);
  });

  it("priced lines with no customer yet", () => {
    expect(isEmptyDraft(draft(941.76, null))).toBe(false);
  });

  it("both", () => {
    expect(isEmptyDraft(draft(941.76, "Megan Farrant"))).toBe(false);
  });
});

describe("the banner on a job whose work is marked complete", () => {
  const panel = (situation: Parameters<typeof buildStatusPanel>[0]["situation"]) =>
    buildStatusPanel({ situation, move: "contractor", firstName: "Megan" });

  it("does not ask for the thing that has already been done", () => {
    expect(
      panel("work_complete").headline,
      "the chip above it reads '✓ Work complete' and the activity log agrees",
    ).not.toMatch(/mark the work complete/i);
  });

  it("names what actually comes next", () => {
    expect(panel("work_complete").headline).toBe("Raise the final invoice to get paid");
  });

  it("leaves the pre-completion state alone", () => {
    // signed_need_invoice is the state where the work genuinely is not marked
    // complete. Its copy is correct and this change must not reach it.
    expect(panel("signed_need_invoice").headline).toBe("Raise an invoice to get paid");
  });
});
