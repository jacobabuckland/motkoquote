// PASS-12 SERIOUS 3, the warning half: editing an accepted quote said nothing.
//
// Reported 16 Sep. A quote accepted by the customer at £1,260.00 was edited by
// the contractor (quantity 4 -> 6). The editor gave no warning that the quote
// was already accepted. On save: just "Saved". The job then reverted from
// "✓ Accepted" to "○ Viewed / Waiting on QA to accept the quote", the customer's
// /q/ link showed £1,860.00 with fresh Accept and Decline buttons, and their
// "You accepted this quote." confirmation was gone.
//
// The machinery to warn before an edit lands has existed since #370 — it is
// just the wrong question:
//
//   editWillDiverge = status === "sent" && ...
//
// An accepted quote is not "sent", so the warning never fired on the one status
// where the consequence is worst. And it cannot be fixed by adding a status to
// that helper, because the two ask different things: `editWillDiverge` asks
// whether two copies of a FIGURE disagree, and this asks whether an AGREEMENT is
// about to be revoked — which happens whether or not the figure moves.
import { describe, expect, it } from "vitest";
import {
  editWillDiverge,
  editWillWithdrawAcceptance,
} from "@/lib/sent-quote-disclosure";

describe("editing a quote the customer has accepted", () => {
  it("warns, on the exact shape that was reported", () => {
    expect(editWillWithdrawAcceptance("accepted")).toBe(true);
  });

  it("warns even when the total does not move", () => {
    // The load-bearing difference from editWillDiverge. Saving an accepted quote
    // clears accepted_at regardless of the figure, so a warning gated on
    // divergence would stay silent while the acceptance was revoked — which is
    // the defect wearing a narrower hat.
    expect(editWillWithdrawAcceptance("accepted")).toBe(true);
    expect(editWillDiverge("accepted", 1260, 1260)).toBe(false);
  });

  it("says nothing on a draft or a sent quote", () => {
    // A sent quote has its own, different warning and must keep it. A draft was
    // never shown to anyone.
    expect(editWillWithdrawAcceptance("sent")).toBe(false);
    expect(editWillWithdrawAcceptance("draft")).toBe(false);
    expect(editWillWithdrawAcceptance("")).toBe(false);
  });

  it("says nothing on a declined quote", () => {
    // There is no acceptance to withdraw.
    expect(editWillWithdrawAcceptance("declined")).toBe(false);
  });

  it("leaves the sent-quote divergence warning exactly as it was", () => {
    // The guard. #370's behaviour must not move: a sent quote whose total has
    // changed still warns, and one whose total has not still does not.
    expect(editWillDiverge("sent", 1260, 1860)).toBe(true);
    expect(editWillDiverge("sent", 1260, 1260)).toBe(false);
    expect(editWillDiverge("sent", null, 1860)).toBe(false);
    expect(editWillDiverge("draft", null, 1860)).toBe(false);
  });
});
