// Ines Kovac's job: a £600 quote, a 100% deposit invoice, paid in full, work
// marked complete — and a banner reading "✓ Work complete — Mark the work
// complete, then invoice", telling the contractor to do the thing it had just
// confirmed was done. Both invoice routes refused, correctly: there was nothing
// left to invoice. The refusals were right; there was no end state to point at.
//
// `depositOnly` was tested on the invoice TYPE alone, which cannot tell a 30%
// deposit from a 100% one, so a job settled entirely through a deposit could
// never reach Paid. `deposit_pct` is already on the contract.
import { describe, expect, it } from "vitest";
import { deriveJobState, deriveSituation } from "@/lib/job-stages";
import type { ContractState, InvoiceState, QuoteState } from "@/lib/job-stages";

const ACCEPTED: QuoteState = {
  status: "accepted",
  sent_at: "2026-09-14T13:09:00.000Z",
  viewed_at: "2026-09-14T13:10:00.000Z",
  accepted_at: "2026-09-14T13:12:00.000Z",
  declined_at: null,
};

const signedWith = (depositPct: number | null): ContractState => ({
  id: "c1",
  status: "signed",
  sent_at: "2026-09-14T13:20:36.000Z",
  signed_at: "2026-09-14T13:23:34.000Z",
  deposit_pct: depositPct,
});

const paidDeposit: InvoiceState = {
  id: "i1",
  status: "paid",
  invoice_type: "deposit",
  due_date: null,
  created_at: "2026-09-14T13:24:00.000Z",
  paid_at: "2026-09-14T13:30:00.000Z",
};

describe("a job settled entirely through a 100% deposit", () => {
  it("is paid", () => {
    const { situation } = deriveSituation(ACCEPTED, signedWith(100), [paidDeposit]);
    expect(situation).toBe("paid");
  });

  it("ticks Invoiced and Paid", () => {
    const state = deriveJobState(ACCEPTED, signedWith(100), [paidDeposit]);
    expect(state.stages.find((s) => s.key === "invoiced")?.state).toBe("complete");
    expect(state.stages.find((s) => s.key === "paid")?.state).toBe("complete");
  });

  it("asks the contractor for nothing further", () => {
    const state = deriveJobState(ACCEPTED, signedWith(100), [paidDeposit]);
    expect(state.move).toBe("none");
  });
});

describe("a partial deposit is unchanged", () => {
  it("does not close on a 30% deposit alone", () => {
    const { situation } = deriveSituation(ACCEPTED, signedWith(30), [paidDeposit]);
    expect(situation).not.toBe("paid");
  });

  it("does not tick Paid on a 30% deposit alone", () => {
    const state = deriveJobState(ACCEPTED, signedWith(30), [paidDeposit]);
    expect(state.stages.find((s) => s.key === "paid")?.state).not.toBe("complete");
  });

  it("treats an absent deposit_pct as partial, not as the whole job", () => {
    const state = deriveJobState(ACCEPTED, signedWith(null), [paidDeposit]);
    expect(state.stages.find((s) => s.key === "paid")?.state).not.toBe("complete");
  });
});

describe("the Invoiced row settles once and stays", () => {
  it("does not un-tick when the deposit is paid", () => {
    // The flip: a raised deposit ticked Invoiced and un-ticked when paid.
    //
    // Completeness, not the whole stage state — "current" legitimately moves
    // along the pipeline as the job progresses, and asserting the full state
    // would pin that too.
    const unpaid = { ...paidDeposit, status: "sent", paid_at: null };
    const completeness = (contractPct: number, invoices: InvoiceState[]) =>
      deriveJobState(ACCEPTED, signedWith(contractPct), invoices).stages.find(
        (s) => s.key === "invoiced",
      )?.state === "complete";

    expect(completeness(30, [unpaid])).toBe(completeness(30, [paidDeposit]));
    // And the same on the 100% job, in the other direction: ticked either way.
    expect(completeness(100, [unpaid])).toBe(true);
    expect(completeness(100, [paidDeposit])).toBe(true);
  });
});
