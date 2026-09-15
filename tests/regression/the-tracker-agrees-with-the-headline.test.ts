// One screen said "Raise an invoice to get paid" over ✓ Invoiced and ✓ Paid.
//
// #739 put the deposit rule on the job's SITUATION — a settled deposit with no
// closing invoice beside it does not close the job — and the badge and headline
// followed it correctly. The milestone tracker did not, because it is derived
// separately:
//
//     invoiced: { complete: invoices.length > 0 }
//     paid:     { complete: !!paidInvoice }
//
// Both are true the instant a deposit settles. So a £1,440 job whose 25%
// deposit had just been marked paid showed the SIGNED badge and the headline
// "Raise an invoice to get paid", and immediately below them ✓ Invoiced and
// ✓ Paid. Reported 13 Sep, alongside the pre-existing live job showing
// ✓ Invoiced 8 Sept over ✓ Paid 7 Sept against a £72 deposit on £7,200.
//
// A deposit is partial by definition: it neither invoices the job nor pays it.
// Tested on the invoice TYPE, needing no figures, exactly as the situation rule
// is — see the long note in job-stages.ts for why amounts were rejected.
//
// THE INVOICED ROW HAS NOW BEEN WRONG IN BOTH DIRECTIONS. Read this before
// changing it a third time.
//
//   13 Sep  complete: invoices.length > 0 && !!paidInvoice-adjacent logic
//           -> a settled deposit ticked Invoiced AND Paid. Fixed.
//   15 Sep  complete: invoices.length > 0 && !depositOnly, where depositOnly
//           first turned on payment -> the row ticked when the deposit was
//           raised and UN-ticked when it was paid. Fixed by dropping the
//           payment dependency...
//   15 Sep  ...which left `!depositOnly` denying a deposit invoice outright.
//           The tracker read "○ Invoiced" with no date beside an Invoices
//           panel showing "Deposit · £756.00 — Due 22 Sept" and a P&L reading
//           "Invoiced (net) £630.00". Three live jobs. Found by the pass-7
//           review.
//
// THE RULE THAT HOLDS ALL OF IT, and the reason the three above could not:
// the two rows answer DIFFERENT questions, and each must answer only its own.
//
//   Invoiced -> has an invoice been issued?   invoices.length > 0
//   Paid     -> is the job settled?           a payment, no deposit-only, none outstanding
//
// Every past defect came from making Invoiced answer some part of Paid's
// question — "in full", "and settled", "and not merely a deposit". It is
// independent of payment by construction, which is also what makes it
// monotonic: an invoice that exists cannot stop existing, so the row cannot
// flip. "The job is not fully invoiced" is real and is carried by the Paid row
// and the status panel's copy, not by denying the Invoiced one.
import { describe, expect, it } from "vitest";
import {
  deriveJobState,
  type ContractState,
  type InvoiceState,
  type QuoteState,
} from "@/lib/job-stages";

const ACCEPTED: QuoteState = {
  status: "accepted",
  sent_at: "2026-09-01T00:00:00Z",
  viewed_at: "2026-09-02T00:00:00Z",
  accepted_at: "2026-09-03T00:00:00Z",
  declined_at: null,
};

const SIGNED: ContractState = {
  id: "c1",
  status: "signed",
  sent_at: "2026-09-04T00:00:00Z",
  signed_at: "2026-09-05T00:00:00Z",
  deposit_pct: 25,
};

const invoice = (over: Partial<InvoiceState>): InvoiceState => ({
  id: "i1",
  status: "paid",
  invoice_type: "deposit",
  due_date: null,
  created_at: "2026-09-08T00:00:00Z",
  paid_at: "2026-09-07T00:00:00Z",
  ...over,
});

const SETTLED_DEPOSIT = invoice({ invoice_type: "deposit" });

const stageOf = (invoices: InvoiceState[], key: string, depositPct?: number) => {
  const contract = depositPct == null ? SIGNED : { ...SIGNED, deposit_pct: depositPct };
  const { stages } = deriveJobState(ACCEPTED, contract, invoices);
  return stages.find((s) => s.key === key);
};

describe("a settled deposit and nothing else", () => {
  it("TICKS Invoiced, because a deposit invoice is an invoice", () => {
    // REVERSED 15 Sep by the pass-7 review. See the note at the top of the
    // file — this row has now been wrong in both directions, and the rule that
    // holds both is stated there.
    expect(stageOf([SETTLED_DEPOSIT], "invoiced")?.state).toBe("complete");
  });

  it("does not tick Paid", () => {
    expect(stageOf([SETTLED_DEPOSIT], "paid")?.state).not.toBe("complete");
  });

  it("agrees with the situation the same job derives", () => {
    // Still the whole point: one screen, one answer. What changed on 15 Sep is
    // which answer. The headline asks for the BALANCE invoice, and the tracker
    // says an invoice was raised and the job is not paid. Both are true of
    // this job at once, and neither claims settlement.
    const { situation, stages } = deriveJobState(ACCEPTED, SIGNED, [SETTLED_DEPOSIT]);

    expect(situation).toBe("signed_need_invoice");
    expect(stages.find((s) => s.key === "invoiced")?.state).toBe("complete");
    expect(stages.find((s) => s.key === "paid")?.state).not.toBe("complete");
  });

  it("still ticks the stages that genuinely happened", () => {
    // Nothing about the earlier milestones is in doubt — the quote was sent,
    // accepted, and the contract signed.
    const { stages } = deriveJobState(ACCEPTED, SIGNED, [SETTLED_DEPOSIT]);

    expect(stages.find((s) => s.key === "quote_sent")?.state).toBe("complete");
    expect(stages.find((s) => s.key === "accepted")?.state).toBe("complete");
    expect(stages.find((s) => s.key === "contract_signed")?.state).toBe("complete");
  });

  it("counts a deposit settled by paid_at alone, not only by status", () => {
    const byDate = invoice({ status: "sent", paid_at: "2026-09-07T00:00:00Z" });
    expect(stageOf([byDate], "paid")?.state).not.toBe("complete");
  });
});

describe("an UNSETTLED deposit", () => {
  it("ticks Invoiced too — paying it changes nothing here", () => {
    // The anti-flip claim, and the reason the 15 Sep over-correction happened.
    //
    // This row must not depend on PAYMENT in either direction. When it did, a
    // raised deposit ticked Invoiced and un-ticked the moment the customer paid
    // it, flipping the headline back to "Raise an invoice to get paid" on a job
    // already invoiced and already part-paid. That was fixed by making the row
    // never tick, which was the wrong half to choose: it then denied an invoice
    // the customer was holding.
    //
    // `invoices.length > 0` is independent of payment by construction, so this
    // assertion and the settled-deposit one above now agree rather than
    // competing — which is what the previous pair could not do.
    const unpaidDeposit = invoice({ status: "sent", paid_at: null });
    expect(stageOf([unpaidDeposit], "invoiced")?.state).toBe("complete");
  });

  it("never un-ticks Invoiced when the deposit is paid", () => {
    // The 15 Sep defect stated directly, so neither reversal can bring it back.
    const raised = invoice({ status: "sent", paid_at: null });
    const settled = invoice({ status: "paid", paid_at: "2026-09-07T00:00:00Z" });

    expect(stageOf([raised], "invoiced")?.state).toBe("complete");
    expect(stageOf([settled], "invoiced")?.state).toBe("complete");
  });

  it("ticks Invoiced when the deposit IS the whole job", () => {
    // A 100% deposit is not partial, and the invoice-type test cannot see that.
    const unpaidDeposit = invoice({ status: "sent", paid_at: null });
    expect(stageOf([unpaidDeposit], "invoiced", 100)?.state).toBe("complete");
  });

  it("does not tick Paid", () => {
    const unpaidDeposit = invoice({ status: "sent", paid_at: null });
    expect(stageOf([unpaidDeposit], "paid")?.state).not.toBe("complete");
  });
});

describe("jobs that really are invoiced and paid — these must not change", () => {
  it("ticks both on a settled final invoice", () => {
    const final = invoice({ invoice_type: "final" });
    expect(stageOf([final], "invoiced")?.state).toBe("complete");
    expect(stageOf([final], "paid")?.state).toBe("complete");
  });

  it("ticks both on a deposit AND a final, both settled", () => {
    const both = [SETTLED_DEPOSIT, invoice({ id: "i2", invoice_type: "final" })];
    expect(stageOf(both, "invoiced")?.state).toBe("complete");
    expect(stageOf(both, "paid")?.state).toBe("complete");
  });

  it("ticks Invoiced once a final is raised beside the settled deposit", () => {
    // The balance is now asked for, so the job HAS been invoiced — even though
    // that invoice is still outstanding.
    const raised = [SETTLED_DEPOSIT, invoice({ id: "i2", invoice_type: "final", status: "sent", paid_at: null })];
    expect(stageOf(raised, "invoiced")?.state).toBe("complete");
    expect(stageOf(raised, "paid")?.state).not.toBe("complete");
  });

  it("ticks both on a settled 'full' invoice", () => {
    const full = invoice({ invoice_type: "full" });
    expect(stageOf([full], "invoiced")?.state).toBe("complete");
    expect(stageOf([full], "paid")?.state).toBe("complete");
  });
});
