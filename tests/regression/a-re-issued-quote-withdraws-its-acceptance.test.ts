// #727, written by hand after six derivations died at spec stage.
//
// Jacob's ruling, 13 Sep: an edit voids the acceptance, and only up to the
// point of the contract. Once a contract exists the quote is not editable at
// all — signed or unsigned. A re-issued quote must be accepted again.
//
// The card names the consequence that sets the shape of the work: the rule is
// NOT expressible as a status list. `accepted` with no contract is editable and
// `accepted` with a contract is not — two quotes with the same status and
// different answers.
import { describe, expect, it } from "vitest";
import {
  hasContract,
  quoteEditability,
  QUOTE_LOCKED_BY_CONTRACT,
  WRITABLE_QUOTE_STATUSES,
} from "@/lib/quote-editability";
import {
  reissueEmailBody,
  reissueEmailSubject,
  reissueSmsBody,
  totalMoved,
  type ReissueFacts,
} from "@/lib/reissue-notice";

describe("what may be edited", () => {
  it("allows a draft and a sent quote, as it always did", () => {
    expect(quoteEditability("draft", false)).toEqual({ editable: true, reissues: false });
    expect(quoteEditability("sent", false)).toEqual({ editable: true, reissues: false });
  });

  it("allows an ACCEPTED quote that has no contract, and marks it a re-issue", () => {
    expect(quoteEditability("accepted", false)).toEqual({ editable: true, reissues: true });
  });

  it("REFUSES the same accepted quote once a contract exists", () => {
    // The criterion the card calls out: "A test covering only the
    // accepted-no-contract case would pass against a guard that ignores the
    // contract entirely."
    const locked = quoteEditability("accepted", true);
    expect(locked.editable).toBe(false);
    expect(locked).toMatchObject({ reason: QUOTE_LOCKED_BY_CONTRACT });
  });

  it("refuses a draft or sent quote with a contract too — signed or unsigned", () => {
    // Decision (1) is about the contract existing, not about its status.
    expect(quoteEditability("draft", true).editable).toBe(false);
    expect(quoteEditability("sent", true).editable).toBe(false);
  });

  it("refuses a declined quote, and anything it does not recognise", () => {
    // Guessing wrong here overwrites an agreed document, so an unknown status
    // is refused rather than allowed.
    expect(quoteEditability("declined", false).editable).toBe(false);
    expect(quoteEditability("expired", false).editable).toBe(false);
    expect(quoteEditability("", false).editable).toBe(false);
  });

  it("never reports a re-issue on something it refused", () => {
    for (const status of ["draft", "sent", "accepted", "declined", "nonsense"]) {
      for (const contract of [true, false]) {
        const verdict = quoteEditability(status, contract);
        if (!verdict.editable) expect(verdict.reissues).toBe(false);
      }
    }
  });
});

describe("reading contract presence off a PostgREST embed", () => {
  it("reads an empty to-many embed as NO contract", () => {
    // This killed the fourth derivation. PostgREST returns [] for a to-many
    // embed with no rows, Boolean([]) is true, and the guard would then read
    // "a contract exists" on every job in production — freezing every accepted
    // quote, the exact opposite of decision (1), while the type annotation
    // still said `{ id: string } | null`.
    expect(hasContract([])).toBe(false);
    expect(Boolean([])).toBe(true); // the trap, stated
  });

  it("reads a populated embed as a contract, either shape", () => {
    expect(hasContract([{ id: "c1" }])).toBe(true);
    expect(hasContract({ id: "c1" })).toBe(true);
  });

  it("reads null and undefined as no contract", () => {
    expect(hasContract(null)).toBe(false);
    expect(hasContract(undefined)).toBe(false);
  });
});

describe("the statuses a write predicate may match", () => {
  it("is the old list plus accepted, and nothing else", () => {
    expect([...WRITABLE_QUOTE_STATUSES]).toEqual(["draft", "sent", "accepted"]);
  });

  it("still excludes declined, so an acceptance race cannot overwrite one", () => {
    expect([...WRITABLE_QUOTE_STATUSES]).not.toContain("declined");
  });
});

const FACTS: ReissueFacts = {
  companyName: "Aspire Plastering Limited",
  customerName: "Harriet",
  newTotal: 880,
  oldTotal: 740,
  vatRegistered: false,
  quoteUrl: "https://motko.app/q/abc123",
};

describe("the notice the customer receives", () => {
  it("carries the sentence that may not be softened, in every variant", () => {
    const required = "your earlier acceptance no longer stands";
    expect(reissueEmailBody(FACTS)).toContain(
      "Because the quote has changed, your earlier acceptance no longer stands.",
    );
    expect(reissueEmailBody({ ...FACTS, newTotal: 740 })).toContain(
      "Because the quote has changed, your earlier acceptance no longer stands.",
    );
    expect(reissueSmsBody(FACTS).toLowerCase()).toContain(required);
    expect(reissueSmsBody({ ...FACTS, newTotal: 740 }).toLowerCase()).toContain(required);
  });

  it("names BOTH figures when the money moved", () => {
    // A customer holding two numbers with no idea which is live is the defect.
    const body = reissueEmailBody(FACTS);
    expect(body).toContain("£880.00");
    expect(body).toContain("£740.00");
    expect(reissueSmsBody(FACTS)).toContain("£880.00");
    expect(reissueSmsBody(FACTS)).toContain("£740.00");
  });

  it("uses the SCOPE-ONLY variant when the total did not move", () => {
    // Required, both channels: this item re-issues the SoW too, so an edit can
    // change what the job covers without moving the total, and the figure
    // sentence would then be false.
    const same = { ...FACTS, newTotal: 740 };
    expect(reissueEmailBody(same)).toContain("The amount is unchanged at £740.00, but the details have changed.");
    expect(reissueEmailBody(same)).not.toContain("it was");
    expect(reissueSmsBody(same)).toContain("the amount is unchanged at £740.00");
    expect(reissueSmsBody(same)).not.toContain("(was");
  });

  it("compares totals in pence, so floats do not invent a change", () => {
    expect(totalMoved(740, 740)).toBe(false);
    expect(totalMoved(0.1 + 0.2, 0.3)).toBe(false);
    expect(totalMoved(740, 740.01)).toBe(true);
  });

  it("attributes the change to the trade by name, and points the customer at them", () => {
    const body = reissueEmailBody(FACTS);
    expect(body).toContain("Aspire Plastering Limited has updated the quote you accepted");
    expect(body).toContain("contact Aspire Plastering Limited before accepting");
  });

  it("does NOT accuse the trade", () => {
    // The common case is an honest correction, on the trade's document, to
    // their customer.
    const body = `${reissueEmailBody(FACTS)} ${reissueSmsBody(FACTS)}`.toLowerCase();
    for (const word of ["without telling", "failed to", "incorrectly", "wrongly", "misled"]) {
      expect(body).not.toContain(word);
    }
  });

  it("says in the subject that acceptance is needed again", () => {
    // A customer who has already accepted believes they are done; the subject
    // is the only part that can be relied on to reach them.
    expect(reissueEmailSubject("Aspire Plastering Limited")).toBe(
      "Your updated quote from Aspire Plastering Limited — please accept again",
    );
  });

  it("carries the link on both channels", () => {
    expect(reissueEmailBody(FACTS)).toContain(FACTS.quoteUrl);
    expect(reissueSmsBody(FACTS)).toContain(FACTS.quoteUrl);
  });

  it("presents VAT the way the send path does for a registered trade", () => {
    const registered = reissueEmailBody({ ...FACTS, vatRegistered: true });
    expect(registered).toContain("£880.00");
    // formatMessageAmount, not formatGBP — whatever it appends for a registered
    // trade must be present rather than silently dropped.
    expect(registered).not.toBe(reissueEmailBody({ ...FACTS, vatRegistered: false }));
  });
});
