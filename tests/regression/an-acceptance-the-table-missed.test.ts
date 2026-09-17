// PASS-15 SERIOUS: the acceptance-logging fix was forward-only, and a LIVE job
// still asserted a figure lower than what was agreed.
//
// Migration 85 records every acceptance from the moment it shipped. Its
// backfill could only write the FIRST one, because `accepted_first_at` is all
// the row knows. Pass 15 found what that leaves behind — job 436E3A7C,
// accepted at £960, re-issued to £1,320 and accepted again:
//
//   header                  £1,320
//   "Accepted quotes awaiting contract"   £1,320
//   Activity panel          Quote accepted — £960.00      ← the only acceptance
//
// It is live and invoiceable today. As a document in a dispute it says the
// customer agreed £960 while the contractor is about to contract them £1,320.
//
// THE SECOND ACCEPTANCE WAS NEVER LOST, only never written to the table.
// `accepted_at` is the CURRENT acceptance and a re-issue clears it, so a value
// later than `reissued_at` is by definition an acceptance that happened after
// that re-issue. The figure is derivable on migration 84's own reasoning:
// nothing re-prices a quote except a re-issue, so when the acceptance is later
// than the last one, `total` has not moved since.
import { describe, expect, it } from "vitest";
import { buildTimeline, type QuoteState } from "@/lib/job-stages";

// The reported job. £960 accepted, re-issued to £1,320, accepted again.
const legacy: QuoteState = {
  status: "accepted",
  sent_at: "2026-09-16T09:00:00Z",
  viewed_at: "2026-09-16T09:05:00Z",
  accepted_first_at: "2026-09-16T09:10:00Z",
  accepted_total: 960,
  reissued_at: "2026-09-16T11:00:00Z",
  accepted_at: "2026-09-16T11:30:00Z",
  declined_at: null,
  total: 1320,
};

// All the backfill could write: the first acceptance.
const backfilledOnly = [{ accepted_at: "2026-09-16T09:10:00Z", accepted_total: 960 }];

const labels = (
  quote: QuoteState,
  acceptances?: { accepted_at: string; accepted_total?: number | null }[],
) => buildTimeline(quote, null, [], null, [], acceptances).map((e) => e.label);

describe("a quote re-accepted before the table existed", () => {
  it("names the figure the customer actually agreed to", () => {
    expect(
      labels(legacy, backfilledOnly),
      "the job reads as agreement to £960 while its header says £1,320, and it " +
        "is live and invoiceable today",
    ).toContain("Quote accepted — £1,320.00");
  });

  it("keeps the earlier acceptance as well", () => {
    expect(labels(legacy, backfilledOnly)).toContain("Quote accepted — £960.00");
  });

  it("dates the recovered acceptance to when it happened, not to now", () => {
    const entry = buildTimeline(legacy, null, [], null, [], backfilledOnly).find(
      (e) => e.label === "Quote accepted — £1,320.00",
    );

    expect(entry?.at).toBe("2026-09-16T11:30:00Z");
  });

  it("reads after the re-issue that prompted it", () => {
    // Asserted as the WHOLE sequence, not with indexOf comparisons. `indexOf`
    // returns -1 for a missing entry and -1 is less than everything, so an
    // ordering assertion written that way passes when the entry is absent —
    // which is precisely the defect. This one cannot.
    expect(labels(legacy, backfilledOnly)).toEqual([
      "Quote accepted — £1,320.00",
      "Quote re-issued",
      "Quote accepted — £960.00",
      "Quote viewed",
      "Quote sent",
    ]);
  });
});

describe("what it must NOT do", () => {
  it("adds nothing when the table already covers the later acceptance", () => {
    // Every quote accepted since migration 85. Double-counting here would
    // invent an acceptance that did not happen, which is the defect this whole
    // area exists to stop, arriving from the other direction.
    const recorded = [
      ...backfilledOnly,
      { accepted_at: "2026-09-16T11:30:00Z", accepted_total: 1320 },
    ];

    const atThirteenTwenty = labels(legacy, recorded).filter(
      (l) => l === "Quote accepted — £1,320.00",
    );

    expect(atThirteenTwenty).toHaveLength(1);
  });

  it("adds nothing to a quote that was never re-issued", () => {
    // `accepted_at` equals the first acceptance here, so there is no second one
    // to recover and `total` is the figure already recorded.
    const never: QuoteState = {
      ...legacy,
      reissued_at: null,
      accepted_at: "2026-09-16T09:10:00Z",
      total: 960,
    };

    expect(labels(never, backfilledOnly)).toEqual([
      "Quote accepted — £960.00",
      "Quote viewed",
      "Quote sent",
    ]);
  });

  it("adds nothing when the quote was re-issued and NOT accepted again", () => {
    // The state that matters most for the no-guessing rule: a re-issue clears
    // `accepted_at`, so there is no later acceptance, and `total` is the new
    // figure nobody has agreed to. Reading it here would assert an acceptance
    // that never happened.
    const awaiting: QuoteState = { ...legacy, status: "sent", accepted_at: null };

    expect(labels(awaiting, backfilledOnly)).not.toContain("Quote accepted — £1,320.00");
    expect(labels(awaiting, backfilledOnly)).toContain("Quote accepted — £960.00");
  });

  it("adds nothing when the acceptance predates the re-issue", () => {
    // Belt and braces on the comparison direction. An `accepted_at` older than
    // `reissued_at` should be impossible — the re-issue clears it — but if one
    // survives, `total` is a figure a LATER re-issue overwrote, and that is
    // exactly what migration 84 forbids reading.
    const stale: QuoteState = { ...legacy, accepted_at: "2026-09-16T10:00:00Z" };

    expect(labels(stale, backfilledOnly)).not.toContain("Quote accepted — £1,320.00");
  });

  it("leaves a quote with no acceptances at all alone", () => {
    const unaccepted: QuoteState = {
      status: "sent",
      sent_at: "2026-09-16T09:00:00Z",
      viewed_at: null,
      accepted_at: null,
      declined_at: null,
    };

    expect(labels(unaccepted, [])).toEqual(["Quote sent"]);
  });
});
