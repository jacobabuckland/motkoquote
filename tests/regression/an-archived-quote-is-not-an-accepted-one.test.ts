// Job 30FAEF2A gave four different answers to "did the customer say yes?"
//
//   banner:       "✓ Accepted — Send a contract to sign"
//   tracker:      "✓ Quote sent" with NO DATE, then "Accepted & signed — Your move"
//   quote panel:  "Declined"
//   activity log: "Quote viewed" and nothing else
//   /q/[id]:      live "Accept quote" and "Decline quote" buttons
//
// The quote's status is `archived`, and sent_at, accepted_at and declined_at are
// all null. `deriveSituation` matched none of draft/sent/declined and fell
// through to "Quote is accepted from here on", so each surface landed in a
// different default. The activity log was the only honest one — it showed the
// only event that had actually been recorded.
//
// The contractor was invited to send a contract for a quote the same page said
// had been declined, and which the customer could still accept from their link.
import { describe, expect, it } from "vitest";
import { deriveJobState, deriveSituation } from "@/lib/job-stages";
import type { ContractState, InvoiceState, QuoteState } from "@/lib/job-stages";

const ARCHIVED: QuoteState = {
  status: "archived",
  sent_at: null,
  viewed_at: new Date().toISOString(),
  accepted_at: null,
  declined_at: null,
};

const NO_CONTRACT: ContractState = null;
const NO_INVOICES: InvoiceState[] = [];

describe("an archived quote", () => {
  it("is its own situation, not 'accepted'", () => {
    const { situation, move } = deriveSituation(ARCHIVED, NO_CONTRACT, NO_INVOICES);
    expect(situation).toBe("quote_archived");
    expect(move).toBe("none");
  });

  it("reads as Archived, not Accepted and not Declined", () => {
    const state = deriveJobState(ARCHIVED, NO_CONTRACT, NO_INVOICES);
    expect(state.overallStatus).toBe("Archived");
  });

  it("does not tick a stage it never reached", () => {
    // "✓ Quote sent" with no date beside it: the tick came from the status, the
    // missing date from the truth.
    const state = deriveJobState(ARCHIVED, NO_CONTRACT, NO_INVOICES);
    const sent = state.stages.find((s) => s.key === "quote_sent");
    expect(sent?.state).not.toBe("complete");
    expect(sent?.date ?? null).toBeNull();
  });

  it("still ticks Quote sent when it WAS sent before being archived", () => {
    // Archiving does not un-send a quote. Evidence decides.
    const sentThenArchived = { ...ARCHIVED, sent_at: "2026-09-03T13:55:52.000Z" };
    const state = deriveJobState(sentThenArchived, NO_CONTRACT, NO_INVOICES);
    expect(state.stages.find((s) => s.key === "quote_sent")?.state).toBe("complete");
  });

  it("asks nobody for anything", () => {
    // Terminal. The contractor withdrew it; there is no next move to prompt.
    const state = deriveJobState(ARCHIVED, NO_CONTRACT, NO_INVOICES);
    expect(state.move).toBe("none");
  });
});
