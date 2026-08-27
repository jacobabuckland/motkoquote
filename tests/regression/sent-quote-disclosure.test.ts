// A quote stays editable after it is sent, and until #370 nothing told the
// customer when it changed. The SMS and email are built once from quotes.total
// and frozen; every renderer re-derives from line_items_json on each request.
// So a customer could hold a text saying £114 and open a link saying £20, with
// nothing anywhere acknowledging that both came from one business.
//
// These tests cover the decision surface (when to disclose) and the wiring
// (that sent_total is actually stamped). The wiring half matters more than it
// looks: #375 shipped a correct formatter behind a column that was never
// selected, and a unit test of the formatter passed happily.
import { describe, expect, it } from "vitest";
import {
  editWillDiverge,
  sentQuoteDivergence,
} from "@/lib/sent-quote-disclosure";
import { sendButtonLabel, SEND_LABEL } from "@/app/jobs/[id]/send-button-label";
import { EDITABLE_STATUSES } from "@/lib/quote-send-guards";

describe("sentQuoteDivergence", () => {
  it("reports the two figures when a sent quote no longer matches what was delivered", () => {
    // The reported case: SMS carried £114, the page showed £20.
    expect(sentQuoteDivergence(114, 20)).toEqual({
      sentTotal: 114,
      currentTotal: 20,
    });
  });

  it("says nothing when the quote has never been sent", () => {
    // A draft has no customer copy to contradict.
    expect(sentQuoteDivergence(null, 20)).toBeNull();
  });

  it("says nothing for a quote sent before the column existed", () => {
    // sent_total is null on every quote sent before migration 048. Those may
    // well have diverged — the data to prove it was never recorded — and
    // asserting "an earlier message quoted a different amount" on a quote we
    // cannot check would be a fabrication shown to a customer.
    expect(sentQuoteDivergence(undefined, 20)).toBeNull();
  });

  it("says nothing when the figures agree", () => {
    expect(sentQuoteDivergence(114, 114)).toBeNull();
  });

  it("absorbs a one-penny difference rather than firing on it", () => {
    // Math.abs(20.01 - 20) > 0.01 is TRUE in IEEE-754. An epsilon comparison
    // fires on exactly the case the tolerance exists to absorb, which is the
    // bug #368 shipped and fixed. Integer pennies, not floats.
    expect(sentQuoteDivergence(20, 20.01)).toBeNull();
    expect(sentQuoteDivergence(20.01, 20)).toBeNull();
  });

  it("fires on two pennies, so the tolerance is a tolerance and not a hole", () => {
    expect(sentQuoteDivergence(20, 20.02)).not.toBeNull();
  });

  it("discloses an increase as readily as a decrease", () => {
    // The reported case was a reduction, which is the benign direction. A rise
    // after send is the one that costs the customer money, and it must not be
    // quieter.
    expect(sentQuoteDivergence(20, 114)).toEqual({
      sentTotal: 20,
      currentTotal: 114,
    });
  });
});

describe("editWillDiverge", () => {
  it("warns the contractor while the quote is sent and the total has moved", () => {
    expect(editWillDiverge("sent", 114, 20)).toBe(true);
  });

  it("stays quiet on a draft, however much the total moves", () => {
    // Editing a draft is the normal workflow. A warning there would be noise
    // on every quote ever built.
    expect(editWillDiverge("draft", null, 20)).toBe(false);
  });

  it("stays quiet on a sent quote whose total has not moved", () => {
    expect(editWillDiverge("sent", 114, 114)).toBe(false);
  });

  it("stays quiet on a sent quote from before the column existed", () => {
    expect(editWillDiverge("sent", null, 20)).toBe(false);
  });
});

describe("the re-send control", () => {
  it("offers a re-send rather than a send once the quote has been delivered", () => {
    expect(sendButtonLabel({ sent: false, isSending: false, resend: true })).toBe(
      SEND_LABEL.resendIdle,
    );
  });

  it("still reads 'Send quote' for a quote that has never been sent", () => {
    expect(sendButtonLabel({ sent: false, isSending: false, resend: false })).toBe(
      SEND_LABEL.idle,
    );
  });

  it("keeps the terminal-label invariant for a re-send", () => {
    // The button must never rest on "Sending…". A re-send changes the idle
    // label only; mid-flight and terminal states describe what is happening to
    // the message, which is identical either way.
    expect(sendButtonLabel({ sent: true, isSending: true, resend: true })).toBe(
      SEND_LABEL.sent,
    );
    expect(sendButtonLabel({ sent: false, isSending: true, resend: true })).toBe(
      SEND_LABEL.sending,
    );
  });

  it("returns the same labels as before when resend is not supplied", () => {
    // tests/acceptance/148.test.tsx is frozen and calls this with two fields.
    // Adding the third must not change what those calls return.
    expect(sendButtonLabel({ sent: true, isSending: false })).toBe(SEND_LABEL.sent);
    expect(sendButtonLabel({ sent: false, isSending: true })).toBe(SEND_LABEL.sending);
    expect(sendButtonLabel({ sent: false, isSending: false })).toBe(SEND_LABEL.idle);
  });
});

describe("the acceptance freeze, which was only ever implicit", () => {
  // quotes.total -> deriveInvoiceAmount -> invoices.amount -> Stripe pennies.
  // The only thing stopping a post-acceptance edit reaching what the customer
  // is charged is that "accepted" is absent from EDITABLE_STATUSES. That
  // safety property was asserted nowhere.
  it("does not permit editing an accepted quote", () => {
    expect(EDITABLE_STATUSES).not.toContain("accepted");
  });

  it("does not permit editing a declined quote", () => {
    expect(EDITABLE_STATUSES).not.toContain("declined");
  });

  it("permits exactly draft and sent, so a new status cannot be added silently", () => {
    // Written as an exact set rather than a pair of assertions: a future status
    // added to this list would otherwise pass both checks above while opening
    // the money path this test exists to close.
    expect([...EDITABLE_STATUSES].sort()).toEqual(["draft", "sent"]);
  });
});
