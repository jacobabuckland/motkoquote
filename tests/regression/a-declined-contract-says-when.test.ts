// PASS-12 SERIOUS 4, the log half: a declined contract left no trace.
//
// Reported 16 Sep on contract 1ca57bdf, declined by the customer. The job page
// showed "! Declined / QA declined the contract" — and the Activity panel read
// only:
//
//   Contract sent / Quote accepted / Quote viewed / Quote sent
//
// The decline itself, the customer's decision and the one event a contractor
// most wants a date for, was absent from the history entirely.
//
// The cause is that `buildTimeline` is a PROJECTION of the current rows, so it
// can only show an event that left a surviving timestamp. `contracts.declined_at`
// has existed since migration 49 and is populated on every decline — but
// `ContractState` never carried the field, so there was nothing to push.
//
// One field and one line. The same root cause loses a re-issued quote's
// acceptance, which needs a column that does not exist yet and is its own item.
import { describe, expect, it } from "vitest";
import { buildTimeline, type ContractState, type QuoteState } from "@/lib/job-stages";

const quote: QuoteState = {
  status: "accepted",
  sent_at: "2026-09-10T09:00:00Z",
  viewed_at: "2026-09-10T10:00:00Z",
  accepted_at: "2026-09-10T11:00:00Z",
  declined_at: null,
};

const labels = (contract: ContractState) =>
  buildTimeline(quote, contract, [], null).map((e) => e.label);

describe("a declined contract appears in the Activity panel", () => {
  it("says when it was declined", () => {
    const declined: ContractState = {
      id: "c1",
      status: "declined",
      sent_at: "2026-09-11T09:00:00Z",
      signed_at: null,
      declined_at: "2026-09-12T14:30:00Z",
      deposit_pct: null,
    };

    expect(labels(declined)).toContain("Contract declined");
  });

  it("carries the time the customer actually declined", () => {
    // Not "now", and not the contract's sent date. A contractor reading this
    // panel during a dispute needs the date the decision was made.
    const declined: ContractState = {
      id: "c1",
      status: "declined",
      sent_at: "2026-09-11T09:00:00Z",
      signed_at: null,
      declined_at: "2026-09-12T14:30:00Z",
      deposit_pct: null,
    };

    const entry = buildTimeline(quote, declined, [], null).find(
      (e) => e.label === "Contract declined",
    );
    expect(entry?.at).toBe("2026-09-12T14:30:00Z");
  });

  it("orders it after the contract was sent, in the panel's newest-first order", () => {
    const declined: ContractState = {
      id: "c1",
      status: "declined",
      sent_at: "2026-09-11T09:00:00Z",
      signed_at: null,
      declined_at: "2026-09-12T14:30:00Z",
      deposit_pct: null,
    };

    // buildTimeline sorts most-recent-first, so "later" means a LOWER index.
    const order = labels(declined);
    expect(order.indexOf("Contract declined")).toBeLessThan(order.indexOf("Contract sent"));
  });

  it("says nothing about a decline on a contract that was not declined", () => {
    // The guard. A signed contract, and one merely sent, must read exactly as
    // they do today.
    const signed: ContractState = {
      id: "c1",
      status: "signed",
      sent_at: "2026-09-11T09:00:00Z",
      signed_at: "2026-09-12T14:30:00Z",
      declined_at: null,
      deposit_pct: null,
    };

    expect(labels(signed)).toContain("Contract signed");
    expect(labels(signed)).not.toContain("Contract declined");
  });

  it("leaves a caller that supplies no declined_at exactly as it was", () => {
    // The field is optional so every existing construction of a ContractState
    // keeps compiling AND keeps its behaviour. Absent means "not declined",
    // which is what those callers were already saying.
    const withoutField = {
      id: "c1",
      status: "sent",
      sent_at: "2026-09-11T09:00:00Z",
      signed_at: null,
      deposit_pct: null,
    } as ContractState;

    expect(labels(withoutField)).toEqual([
      "Contract sent",
      "Quote accepted",
      "Quote viewed",
      "Quote sent",
    ]);
  });
});
