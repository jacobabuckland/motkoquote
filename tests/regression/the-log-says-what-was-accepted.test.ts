// PASS-13 SERIOUS 3: the Activity panel implied an acceptance that never
// happened.
//
// Migration 82 stopped a re-issue ERASING the acceptance. The surviving entry
// then became misleading, which the reviewer rightly called worse:
//
//   Quote accepted   18:02
//   Quote viewed     18:01
//   Quote sent       18:00
//
// on a job whose quote now reads £840.00. The customer accepted £600.00. Read
// months later in a dispute, that log says they agreed to £840. Pass 12's
// version destroyed the evidence; this version left evidence pointing the wrong
// way.
//
// Two facts were missing from the row, so two columns (migration 84):
// `accepted_total` says WHAT was agreed beside WHEN, and `reissued_at` gives
// the re-issue a timestamp the panel can render. `announceReissue` has always
// carried a comment saying that entry belongs here, and then sent the event to
// `track()` — an analytics sink the timeline cannot read, which is the thing
// AGENTS.md names outright.
import { describe, expect, it } from "vitest";
import { buildTimeline, type QuoteState } from "@/lib/job-stages";

const labels = (quote: QuoteState) => buildTimeline(quote, null, [], null).map((e) => e.label);

// The reported row: accepted at £600, re-issued at £840.
const reIssued: QuoteState = {
  status: "sent",
  sent_at: "2026-09-16T18:00:00Z",
  viewed_at: "2026-09-16T18:01:00Z",
  accepted_at: null,
  accepted_first_at: "2026-09-16T18:02:00Z",
  accepted_total: 600,
  reissued_at: "2026-09-16T18:45:00Z",
  declined_at: null,
  total: 840,
};

describe("an acceptance says what was accepted", () => {
  it("names the figure the customer agreed to, not the one the quote now shows", () => {
    // £600.00 is on the entry. £840.00 is what `total` says today, and putting
    // that here is the defect: it asserts they agreed to the new price.
    expect(labels(reIssued)).toContain("Quote accepted — £600.00");
    expect(labels(reIssued)).not.toContain("Quote accepted — £840.00");
  });

  it("keeps the plain wording where no figure was recorded", () => {
    // Every quote accepted before migration 84, and every caller not passing
    // the field. Guessing from `total` is exactly what must not happen: after a
    // re-issue that is the NEW figure wearing the old one's clothes.
    const legacy: QuoteState = { ...reIssued, accepted_total: null };

    expect(labels(legacy)).toContain("Quote accepted");
    expect(labels(legacy).some((l) => l.includes("£"))).toBe(false);
  });

  it("shows a zero acceptance as £0.00 rather than dropping the figure", () => {
    // 0 is a recorded answer, and `typeof === "number"` is what keeps it from
    // falling through the nullish check into the plain wording.
    const free: QuoteState = { ...reIssued, accepted_total: 0 };

    expect(labels(free)).toContain("Quote accepted — £0.00");
  });
});

describe("a re-issue appears in the log", () => {
  it("is recorded, at the time it happened", () => {
    const entry = buildTimeline(reIssued, null, [], null).find(
      (e) => e.label === "Quote re-issued",
    );

    expect(entry).toBeDefined();
    expect(entry?.at).toBe("2026-09-16T18:45:00Z");
  });

  it("reads after the acceptance it withdrew", () => {
    // Newest first, so the re-issue comes before the acceptance in the list.
    // A log where the acceptance appears to be the later event is the same
    // misleading record by a different route.
    const order = labels(reIssued);

    expect(order.indexOf("Quote re-issued")).toBeLessThan(
      order.indexOf("Quote accepted — £600.00"),
    );
  });

  it("says nothing on a quote that was never re-issued", () => {
    const untouched: QuoteState = {
      status: "accepted",
      sent_at: "2026-09-16T18:00:00Z",
      viewed_at: "2026-09-16T18:01:00Z",
      accepted_at: "2026-09-16T18:02:00Z",
      accepted_first_at: "2026-09-16T18:02:00Z",
      accepted_total: 600,
      reissued_at: null,
      declined_at: null,
      total: 600,
    };

    expect(labels(untouched)).not.toContain("Quote re-issued");
  });

  it("leaves a quote that predates migration 84 reading exactly as it does today", () => {
    // The guard that matters most. Neither field is passed, so nothing may
    // change: no re-issue entry invented, and the acceptance keeps its wording.
    const before: QuoteState = {
      status: "accepted",
      sent_at: "2026-09-16T18:00:00Z",
      viewed_at: "2026-09-16T18:01:00Z",
      accepted_at: "2026-09-16T18:02:00Z",
      declined_at: null,
    };

    expect(labels(before)).toEqual(["Quote accepted", "Quote viewed", "Quote sent"]);
  });
});
