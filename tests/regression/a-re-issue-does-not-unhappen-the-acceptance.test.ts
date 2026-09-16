// PASS-12 SERIOUS 3, the log half: re-issuing a quote erased the acceptance.
//
// Reported 16 Sep. A quote accepted at £1,260.00 was edited. The job reverted to
// "Waiting on QA to accept the quote" — correctly — but the Activity panel lost
// the "Quote accepted" entry entirely, leaving only Quote viewed and Quote sent.
// If a dispute followed, the audit trail said the customer never accepted
// anything.
//
// `buildTimeline` is a PROJECTION of current row state. The re-issue path clears
// `accepted_at`, correctly — otherwise the job reads as accepted while awaiting
// a second acceptance — and the timeline read that same column, so the
// acceptance did not merely stop being current, it stopped ever having happened.
//
// The code already said this must not happen. `announceReissue` carries the
// comment "the history of the job is not overwritten with it". It was never
// implemented: the event went to `track()`, an analytics sink the timeline
// cannot see, which is the thing AGENTS.md names outright — a signal that must
// change behaviour cannot terminate in telemetry.
//
// `quotes.accepted_first_at` (migration 82) is written on first acceptance and
// never cleared. Same shape for `contracts.withdrawn_at`, which did not exist at
// all, so CONTRACT-1's withdrawal could never appear in the panel either.
import { describe, expect, it } from "vitest";
import { buildTimeline, type ContractState, type QuoteState } from "@/lib/job-stages";

const labels = (quote: QuoteState, contract: ContractState = null) =>
  buildTimeline(quote, contract, [], null).map((e) => e.label);

describe("an acceptance survives the re-issue that withdraws it", () => {
  it("still appears after accepted_at has been cleared", () => {
    // Exactly the reported row: re-issued, so accepted_at is null and the quote
    // is back to "sent" — but it WAS accepted, and the history says so.
    const reIssued: QuoteState = {
      status: "sent",
      sent_at: "2026-09-10T09:00:00Z",
      viewed_at: "2026-09-10T10:00:00Z",
      accepted_at: null,
      accepted_first_at: "2026-09-10T11:00:00Z",
      declined_at: null,
    };

    expect(labels(reIssued)).toContain("Quote accepted");
  });

  it("carries the time of the FIRST acceptance", () => {
    const reIssued: QuoteState = {
      status: "sent",
      sent_at: "2026-09-10T09:00:00Z",
      viewed_at: "2026-09-10T10:00:00Z",
      accepted_at: null,
      accepted_first_at: "2026-09-10T11:00:00Z",
      declined_at: null,
    };

    const entry = buildTimeline(reIssued, null, [], null).find(
      (e) => e.label === "Quote accepted",
    );
    expect(entry?.at).toBe("2026-09-10T11:00:00Z");
  });

  it("prefers the first acceptance over a later one", () => {
    // A quote accepted, re-issued, then accepted again. The panel is a history:
    // it reports when the customer first agreed, not the most recent round.
    const acceptedTwice: QuoteState = {
      status: "accepted",
      sent_at: "2026-09-10T09:00:00Z",
      viewed_at: "2026-09-10T10:00:00Z",
      accepted_at: "2026-09-14T16:00:00Z",
      accepted_first_at: "2026-09-10T11:00:00Z",
      declined_at: null,
    };

    const entry = buildTimeline(acceptedTwice, null, [], null).find(
      (e) => e.label === "Quote accepted",
    );
    expect(entry?.at).toBe("2026-09-10T11:00:00Z");
  });

  it("falls back to accepted_at for every quote that predates the column", () => {
    // The guard that matters most. Migration 82 backfills only what is
    // truthful, so quotes already re-issued carry no accepted_first_at — and
    // every caller not yet passing the field must keep the entry it shows
    // today rather than silently losing one.
    const legacy: QuoteState = {
      status: "accepted",
      sent_at: "2026-09-10T09:00:00Z",
      viewed_at: "2026-09-10T10:00:00Z",
      accepted_at: "2026-09-10T11:00:00Z",
      declined_at: null,
    };

    const entry = buildTimeline(legacy, null, [], null).find(
      (e) => e.label === "Quote accepted",
    );
    expect(entry?.at).toBe("2026-09-10T11:00:00Z");
  });

  it("says nothing about an acceptance on a quote never accepted", () => {
    const neverAccepted: QuoteState = {
      status: "sent",
      sent_at: "2026-09-10T09:00:00Z",
      viewed_at: "2026-09-10T10:00:00Z",
      accepted_at: null,
      declined_at: null,
    };

    expect(labels(neverAccepted)).not.toContain("Quote accepted");
  });
});

describe("a withdrawn contract says when it was withdrawn", () => {
  const quote: QuoteState = {
    status: "accepted",
    sent_at: "2026-09-10T09:00:00Z",
    viewed_at: "2026-09-10T10:00:00Z",
    accepted_at: "2026-09-10T11:00:00Z",
    declined_at: null,
  };

  it("appears in the panel", () => {
    // CONTRACT-1 (#786) shipped withdrawal with no timestamp at all, on my
    // decision that the dashboard's contract list did not need one. That was
    // right about the list and wrong about the Activity panel.
    const withdrawn: ContractState = {
      id: "c1",
      status: "withdrawn",
      sent_at: "2026-09-11T09:00:00Z",
      signed_at: null,
      withdrawn_at: "2026-09-12T15:00:00Z",
      deposit_pct: null,
    };

    expect(labels(quote, withdrawn)).toContain("Contract withdrawn");
  });

  it("keeps the contract's earlier history alongside it", () => {
    // Withdrawal does not unsay that the contract was sent.
    const withdrawn: ContractState = {
      id: "c1",
      status: "withdrawn",
      sent_at: "2026-09-11T09:00:00Z",
      signed_at: null,
      withdrawn_at: "2026-09-12T15:00:00Z",
      deposit_pct: null,
    };

    const order = labels(quote, withdrawn);
    expect(order).toContain("Contract sent");
    // Newest first, so the withdrawal comes before the sending.
    expect(order.indexOf("Contract withdrawn")).toBeLessThan(order.indexOf("Contract sent"));
  });

  it("says nothing on a contract that was not withdrawn", () => {
    const signed: ContractState = {
      id: "c1",
      status: "signed",
      sent_at: "2026-09-11T09:00:00Z",
      signed_at: "2026-09-12T09:00:00Z",
      deposit_pct: null,
    };

    expect(labels(quote, signed)).not.toContain("Contract withdrawn");
  });
});
