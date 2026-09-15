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
  it("does not tick Invoiced", () => {
    expect(stageOf([SETTLED_DEPOSIT], "invoiced")?.state).not.toBe("complete");
  });

  it("does not tick Paid", () => {
    expect(stageOf([SETTLED_DEPOSIT], "paid")?.state).not.toBe("complete");
  });

  it("agrees with the situation the same job derives", () => {
    // The whole point: one screen, one answer. The headline asks for an
    // invoice, so the tracker must not claim one was raised and settled.
    const { situation, stages } = deriveJobState(ACCEPTED, SIGNED, [SETTLED_DEPOSIT]);

    expect(situation).toBe("signed_need_invoice");
    expect(stages.find((s) => s.key === "invoiced")?.state).not.toBe("complete");
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
  it("does not tick Invoiced either — paying it changes nothing here", () => {
    // SUPERSEDES "ticks Invoiced, because one genuinely was raised".
    //
    // That assertion and "a settled deposit … does not tick Invoiced" above
    // could not both hold without the row turning on PAYMENT, and it did: a
    // raised deposit ticked Invoiced and then un-ticked the moment the customer
    // paid it, flipping the headline back to "Raise an invoice to get paid" on
    // a job already invoiced and already part-paid. Reported 15 Sep.
    //
    // The rule this file states is the one kept: "a deposit is partial by
    // definition, so until a closing invoice exists beside it, neither row is
    // complete". Whether the job is only-a-deposit is a fact about which
    // invoices exist, not about whether money has arrived — so the row now
    // settles one way and stays there, whichever way that is.
    const unpaidDeposit = invoice({ status: "sent", paid_at: null });
    expect(stageOf([unpaidDeposit], "invoiced")?.state).not.toBe("complete");
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
