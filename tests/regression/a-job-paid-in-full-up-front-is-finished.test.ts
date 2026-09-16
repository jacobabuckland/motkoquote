// PASS-8 FINDING 4: a job paid 100% up front could never reach "Paid".
//
// Reported 15 Sep on a £1,481.48 job (fixed price £1,234.57 + VAT), deposit
// 100%, quote accepted, contract signed, the whole amount invoiced as a deposit
// and marked paid, work marked complete. The job then read:
//
//   tracker:    Accepted & signed ✓ / Invoiced ✓ / Paid ○
//   headline:   "Mark the work complete, then invoice"
//   actions:    "Send invoice" — which refused, correctly, with
//               "This quote is already fully invoiced"
//   dashboard:  filed under ACCEPTED QUOTES AWAITING INVOICE
//
// Every penny collected, and the only offered action could never succeed.
//
// THIS IS A REGRESSION FROM #722, not a gap it left. `depositIsWholeJob` asked
// `contract.deposit_pct >= 100`. #722 moved deposits to
// `quotes.deposit_pennies`, so a 100% deposit agreed on the QUOTE leaves
// `deposit_pct` null, the check answers false, and the job is deposit-only for
// ever. The tell is in the reporter's own notes: the dashboard's
// "£2,808.00 of agreed work hasn't been invoiced yet" correctly EXCLUDED this
// job. One figure knew it was finished; the tracker and the list did not.
//
// The fix routes the question through resolveDeposit — the same resolver that
// decides what gets invoiced at signature — so the two cannot disagree again.
import { describe, expect, it } from "vitest";
import {
  deriveJobState,
  type ContractState,
  type InvoiceState,
  type QuoteState,
} from "@/lib/job-stages";

const TOTAL = 1481.48;

const accepted = (extra: Partial<NonNullable<QuoteState>> = {}): QuoteState => ({
  status: "accepted",
  sent_at: "2026-09-01T00:00:00Z",
  viewed_at: "2026-09-02T00:00:00Z",
  accepted_at: "2026-09-03T00:00:00Z",
  declined_at: null,
  ...extra,
});

const signed = (depositPct: number | null): ContractState => ({
  id: "c1",
  status: "signed",
  sent_at: "2026-09-04T00:00:00Z",
  signed_at: "2026-09-05T00:00:00Z",
  deposit_pct: depositPct,
});

const settledDeposit: InvoiceState = {
  id: "inv-1",
  status: "paid",
  invoice_type: "deposit",
  due_date: "2026-09-12",
  created_at: "2026-09-05T00:01:00Z",
  paid_at: "2026-09-06T00:00:00Z",
};

const stageOf = (state: ReturnType<typeof deriveJobState>, key: string) =>
  state.stages.find((s) => s.key === key)?.state;

describe("a 100% deposit agreed on the QUOTE closes the job", () => {
  // The reported shape: deposit_pennies is the whole total, deposit_pct null.
  const quote = accepted({ total: TOTAL, deposit_pennies: Math.round(TOTAL * 100) });

  it("ticks Paid", () => {
    const state = deriveJobState(quote, signed(null), [settledDeposit]);
    expect(stageOf(state, "paid")).toBe("complete");
  });

  it("reads as paid rather than as awaiting an invoice", () => {
    const state = deriveJobState(quote, signed(null), [settledDeposit]);

    expect(state.situation).toBe("paid");
    expect(state.overallStatus).toBe("Paid");
    // Nobody's move. The job is done.
    expect(state.move).toBe("none");
  });

  it("does not ask for an invoice it would then refuse to raise", () => {
    // The trap, stated as the contradiction it was: the situation asked for an
    // invoice while the quote was already fully invoiced.
    const state = deriveJobState(quote, signed(null), [settledDeposit]);

    expect(state.situation).not.toBe("signed_need_invoice");
    expect(state.situation).not.toBe("work_complete");
  });

  it("closes it with the work marked complete too", () => {
    // The reported job had work_completed_at set, which is the fifth argument.
    const state = deriveJobState(quote, signed(null), [settledDeposit], Date.now(), "2026-09-07T00:00:00Z");

    expect(state.situation).toBe("paid");
    expect(stageOf(state, "paid")).toBe("complete");
  });
});

describe("the legacy route still works", () => {
  it("closes a 100% deposit stated on the CONTRACT, with nothing on the quote", () => {
    // The seven pre-migration-81 rows. This is what the check always handled
    // and it must keep handling it.
    const state = deriveJobState(accepted(), signed(100), [settledDeposit]);

    expect(state.situation).toBe("paid");
    expect(stageOf(state, "paid")).toBe("complete");
  });

  it("closes it when the quote carries figures AND the contract says 100%", () => {
    const state = deriveJobState(
      accepted({ total: TOTAL, deposit_pennies: null }),
      signed(100),
      [settledDeposit],
    );

    expect(state.situation).toBe("paid");
  });
});

describe("a PARTIAL deposit still leaves the job open", () => {
  // The guard that must not move. This is the defect #739 fixed — a settled
  // deposit closing a job whose balance is still owed — and nothing here may
  // reintroduce it.
  const quarter = accepted({ total: TOTAL, deposit_pennies: Math.round(TOTAL * 25) });

  it("does not tick Paid on a settled 25% deposit", () => {
    const state = deriveJobState(quarter, signed(null), [settledDeposit]);

    expect(stageOf(state, "paid")).not.toBe("complete");
    expect(state.situation).not.toBe("paid");
  });

  it("asks for the balance invoice", () => {
    const state = deriveJobState(quarter, signed(null), [settledDeposit]);
    expect(state.situation).toBe("signed_need_invoice");
  });

  it("does not close a 99% deposit either", () => {
    // Just under is still not the whole job. A >= comparison in pennies is
    // what decides it, so the boundary is worth pinning.
    const almost = accepted({ total: TOTAL, deposit_pennies: Math.round(TOTAL * 99) });
    const state = deriveJobState(almost, signed(null), [settledDeposit]);

    expect(state.situation).not.toBe("paid");
  });
});

describe("missing figures fall back rather than guessing", () => {
  it("keeps the old answer when the quote supplies no total", () => {
    // Every caller that does not pass the new fields must behave exactly as it
    // did. Answering "the deposit is the whole job" on absent data would close
    // jobs that are not paid — the expensive direction to be wrong in.
    const state = deriveJobState(accepted(), signed(null), [settledDeposit]);

    expect(state.situation).not.toBe("paid");
    expect(stageOf(state, "paid")).not.toBe("complete");
  });

  it("treats a recorded ZERO deposit as no deposit, not as the whole job", () => {
    // A £0 total would make any comparison true. The guard is on the total.
    const state = deriveJobState(
      accepted({ total: TOTAL, deposit_pennies: 0 }),
      signed(null),
      [settledDeposit],
    );

    expect(state.situation).not.toBe("paid");
  });
});
