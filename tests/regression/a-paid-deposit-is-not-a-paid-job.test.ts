// A £72 deposit marked a £7,200 job complete, and hid £7,128.
//
// Reported 13 Sep against a live job. One payment had been taken — a 1% deposit
// of £72, settled 7 Sept — and no final invoice was ever raised. The job showed:
//
//   * the Paid badge against a £7,200.00 header
//   * every milestone ticked, including Paid
//   * "Job complete — you've been paid / Nothing else needs you on this one"
//   * "Everything's settled. Nothing else to do."
//
// The £7,128 the customer contractually owes appeared on no screen in the app.
// It existed only on the PDF the customer holds, which is exactly the wrong
// asymmetry.
//
// The cause: `jobClosed` was `!firstUnpaid(invoices)` — "no invoice is awaiting
// payment". That is true the instant a deposit settles, because the balance has
// not been invoiced yet and so cannot be outstanding. A settled invoice was
// being read as a settled job.
//
// The rule is on the invoice TYPE: a deposit is partial by definition, so a
// settled deposit with no closing invoice beside it does not close the job.
//
// DELIBERATELY NOT a comparison of amounts against the quote total. That was
// tried first and broke seven assertions in `tests/acceptance/587.test.tsx`,
// whose fixtures pair a £50,000 quote with a £500 final invoice — and the two
// columns do not agree on units across the fixtures in the tree (one carries
// `total: 17000, // £170.00`). The type test needs no figures, so none of that
// can throw it, and it is the narrower claim: a `final` invoice raised for less
// than the quote is a discount or a variation, which is the contractor's
// business and not this function's.
import { describe, expect, it } from "vitest";
import {
  deriveSituation,
  type ContractState,
  type InvoiceState,
  type QuoteState,
} from "@/lib/job-stages";

const ACCEPTED_QUOTE: QuoteState = {
  status: "accepted",
  sent_at: "2026-09-01T00:00:00Z",
  viewed_at: "2026-09-02T00:00:00Z",
  accepted_at: "2026-09-03T00:00:00Z",
  declined_at: null,
};

const SIGNED_CONTRACT: ContractState = {
  id: "c1",
  status: "signed",
  sent_at: "2026-09-04T00:00:00Z",
  signed_at: "2026-09-05T00:00:00Z",
  deposit_pct: 1,
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

/** The reported job: a settled deposit, and nothing else ever raised. */
const THE_DEPOSIT = invoice({ invoice_type: "deposit" });

describe("the reported job", () => {
  it("is not 'paid' on a settled deposit alone", () => {
    const { situation } = deriveSituation(ACCEPTED_QUOTE, SIGNED_CONTRACT, [THE_DEPOSIT]);
    expect(situation).not.toBe("paid");
  });

  it("asks the contractor to raise the invoice that is due", () => {
    const { situation, move } = deriveSituation(ACCEPTED_QUOTE, SIGNED_CONTRACT, [THE_DEPOSIT]);
    expect(situation).toBe("signed_need_invoice");
    expect(move).toBe("contractor");
  });

  it("becomes work_complete once the work is done, which is when the balance is actionable", () => {
    const { situation, move } = deriveSituation(
      ACCEPTED_QUOTE,
      SIGNED_CONTRACT,
      [THE_DEPOSIT],
      Date.now(),
      "2026-09-10T00:00:00Z",
    );
    expect(situation).toBe("work_complete");
    expect(move).toBe("contractor");
  });

  it("counts a deposit settled by paid_at alone, not only by status", () => {
    const settledByDate = invoice({ status: "sent", paid_at: "2026-09-07T00:00:00Z" });
    const { situation } = deriveSituation(ACCEPTED_QUOTE, SIGNED_CONTRACT, [settledByDate]);
    expect(situation).not.toBe("paid");
  });
});

describe("jobs that really are settled — these must not change", () => {
  // The shapes the frozen acceptance fixtures use. If any of these stops
  // reading "paid", the rule has been drawn too wide.
  it("is paid on a settled final invoice", () => {
    const { situation, move } = deriveSituation(ACCEPTED_QUOTE, SIGNED_CONTRACT, [
      invoice({ invoice_type: "final" }),
    ]);
    expect(situation).toBe("paid");
    expect(move).toBe("none");
  });

  it("is paid on a settled 'full' invoice", () => {
    const { situation } = deriveSituation(ACCEPTED_QUOTE, SIGNED_CONTRACT, [
      invoice({ invoice_type: "full" }),
    ]);
    expect(situation).toBe("paid");
  });

  it("is paid on a deposit AND a final, both settled", () => {
    const { situation } = deriveSituation(ACCEPTED_QUOTE, SIGNED_CONTRACT, [
      THE_DEPOSIT,
      invoice({ id: "i2", invoice_type: "final" }),
    ]);
    expect(situation).toBe("paid");
  });

  it("is paid on a final invoice for less than the quote — not this function's business", () => {
    // A discount or a variation. The rule is about the deposit TYPE, not about
    // whether the figures add up.
    const { situation } = deriveSituation(ACCEPTED_QUOTE, SIGNED_CONTRACT, [
      invoice({ invoice_type: "final" }),
    ]);
    expect(situation).toBe("paid");
  });
});

describe("an unsettled balance still reads as awaiting payment", () => {
  it("does not become 'raise an invoice' when one has already been raised", () => {
    const { situation, move } = deriveSituation(ACCEPTED_QUOTE, SIGNED_CONTRACT, [
      THE_DEPOSIT,
      invoice({ id: "i2", invoice_type: "final", status: "sent", paid_at: null }),
    ]);
    expect(situation).toBe("invoice_unpaid");
    expect(move).toBe("customer");
  });

  it("leaves an unsettled deposit alone — nothing here is settled yet", () => {
    const { situation, move } = deriveSituation(ACCEPTED_QUOTE, SIGNED_CONTRACT, [
      invoice({ status: "sent", paid_at: null }),
    ]);
    expect(situation).toBe("invoice_unpaid");
    expect(move).toBe("customer");
  });
});

describe("a job with no invoices at all is unchanged", () => {
  it("still asks for the first invoice on a signed contract", () => {
    const { situation, move } = deriveSituation(ACCEPTED_QUOTE, SIGNED_CONTRACT, []);
    expect(situation).toBe("signed_need_invoice");
    expect(move).toBe("contractor");
  });
});
