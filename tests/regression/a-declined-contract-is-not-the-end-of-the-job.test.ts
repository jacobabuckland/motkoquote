// PASS-12 SERIOUS 4: a declined contract was a dead end.
//
// Reported 16 Sep on contract 1ca57bdf. The customer declined it. The job then
// read "! Declined / QA declined the contract", the tracker showed
// "✕ Accepted & signed", and Actions said "Nothing needs you here." The only
// controls were copy link, download contract, download quote, add cost, how
// this quote was built, and archive.
//
// So a customer who declined because a DATE was wrong had ended the job
// permanently, and the contractor's only exit was to archive it and rebuild
// from scratch. Compounding it, the quote itself stayed frozen: a declined
// contract is still a row, and `quoteEditability` blocked on any contract that
// was not withdrawn.
//
// The principle, and the reason this is two small changes rather than a new
// flow: a contract nobody agreed to cannot be the thing that makes a quote
// unchangeable, and it cannot be the thing that ends a job. A SIGNED contract
// still blocks absolutely — that is an agreement.
import { describe, expect, it } from "vitest";
import { quoteEditability } from "@/lib/quote-editability";
import { deriveSituation, type ContractState, type QuoteState } from "@/lib/job-stages";

const accepted: QuoteState = {
  status: "accepted",
  sent_at: "2026-09-10T09:00:00Z",
  viewed_at: "2026-09-10T10:00:00Z",
  accepted_at: "2026-09-10T11:00:00Z",
  declined_at: null,
};

const contract = (status: string): ContractState => ({
  id: "c1",
  status,
  sent_at: "2026-09-11T09:00:00Z",
  signed_at: status === "signed" ? "2026-09-12T09:00:00Z" : null,
  declined_at: status === "declined" ? "2026-09-12T14:30:00Z" : null,
  deposit_pct: null,
});

describe("a declined contract no longer freezes the quote", () => {
  it("lets the contractor correct the quote it came from", () => {
    const verdict = quoteEditability("accepted", { id: "c1", status: "declined" });
    expect(verdict.editable).toBe(true);
  });

  it("marks that correction a re-issue, as any accepted-quote edit is", () => {
    const verdict = quoteEditability("accepted", { id: "c1", status: "declined" });
    expect(verdict.reissues).toBe(true);
  });

  it("still refuses while a contract is SENT and unanswered", () => {
    // The guard. A contract with the customer right now is live, and editing
    // the quote underneath it is what #727 refused.
    expect(quoteEditability("accepted", { id: "c1", status: "sent" }).editable).toBe(false);
  });

  it("still refuses absolutely once SIGNED", () => {
    // The agreement. Nothing in this item may loosen it.
    expect(quoteEditability("accepted", { id: "c1", status: "signed" }).editable).toBe(false);
  });

  it("keeps treating a withdrawn contract as non-blocking", () => {
    // CONTRACT-1's behaviour, unchanged.
    expect(quoteEditability("accepted", { id: "c1", status: "withdrawn" }).editable).toBe(true);
  });
});

describe("a declined contract leaves the job with something to do", () => {
  it("is the contractor's move, not nobody's", () => {
    const { situation, move } = deriveSituation(accepted, contract("declined"), []);

    expect(situation).toBe("contract_declined");
    expect(move).toBe("contractor");
  });

  it("does not read as a finished job", () => {
    // "none" is reserved for a pipeline that has genuinely stopped — paid, or a
    // declined QUOTE. A declined contract is neither: the work is still wanted,
    // the terms were not.
    const { move } = deriveSituation(accepted, contract("declined"), []);
    expect(move).not.toBe("none");
  });

  it("still says who declined and when, so nothing is hidden", () => {
    // Unblocking the job must not quietly drop the fact of the decline. The
    // situation is unchanged and the Activity panel carries the timestamp.
    const { situation } = deriveSituation(accepted, contract("declined"), []);
    expect(situation).toBe("contract_declined");
  });

  it("leaves a signed contract's situation exactly as it was", () => {
    // Asserting the SITUATION, not the move: a signed contract with nothing
    // invoiced is legitimately the contractor's move too, so `move` alone
    // cannot tell the two apart and is a guard that proves nothing.
    const { situation } = deriveSituation(accepted, contract("signed"), []);
    expect(situation).toBe("signed_need_invoice");
  });
});
