// 20 SEP, from a walk of motko.app. Under the heading "Unpaid invoices" on
// My work:
//
//     Megan Farrant · Awaiting payment · general · updated today · £1,740.00
//
// The unpaid invoice is £348.00 — a 20% deposit on a £1,740 job. The dashboard
// said £348, Money position said £348, the job page said £348, and the same
// page's own totals band said "BILLED £8,285.48 / COLLECTED £7,937.48", a gap
// of exactly £348.00. Only the row disagreed, and it disagreed with the header
// directly above it.
//
// A trade glancing at My work reads £1,740 owed when £1,392 of it has not been
// invoiced at all.
//
// Both figures were already on the row: `invoicedAmount` and `collectedAmount`
// are summed from the invoice rows to feed that totals band. The row was
// reading `amount`, which is what the job is WORTH — the right answer for a
// draft or a quote out for acceptance, and the wrong one for a question about
// what is owed.
import { describe, expect, it } from "vitest";
import { rowAmount, type HistoryJob } from "@/lib/job-history";

const job = (over: Partial<HistoryJob>): HistoryJob => ({
  jobId: "job_1",
  customerName: "Megan Farrant",
  title: "general",
  amount: 1740,
  status: "Awaiting payment" as HistoryJob["status"],
  bucket: "in_progress",
  paidAt: null,
  invoiced: true,
  invoicedAmount: 348,
  collectedAmount: 0,
  sortAt: "2026-09-20T09:00:00Z",
  situation: "invoice_unpaid",
  ...over,
});

describe("a row under Unpaid invoices", () => {
  it("shows what the customer has been asked for, not what the job is worth", () => {
    expect(rowAmount(job({}))).toBe(348);
  });

  it("nets off what has already been collected", () => {
    // Two invoices, one settled: £348 deposit paid, £1,392 balance outstanding.
    expect(rowAmount(job({ invoicedAmount: 1740, collectedAmount: 348 }))).toBe(1392);
  });

  it("does the same for an overdue invoice", () => {
    expect(rowAmount(job({ situation: "invoice_overdue" }))).toBe(348);
  });
});

describe("what a job is worth is still the answer everywhere else", () => {
  it("on a draft", () => {
    expect(rowAmount(job({ situation: "draft_quote", invoiced: false }))).toBe(1740);
  });

  it("on a quote out for acceptance", () => {
    expect(rowAmount(job({ situation: "quote_sent", invoiced: false }))).toBe(1740);
  });

  it("on a contract waiting to be signed", () => {
    expect(rowAmount(job({ situation: "contract_sent", invoiced: false }))).toBe(1740);
  });

  it("on a job that is paid", () => {
    expect(rowAmount(job({ situation: "paid", collectedAmount: 1740 }))).toBe(1740);
  });
});

describe("where the invoice figures are missing entirely", () => {
  it("falls back to the job's worth rather than claiming nothing is owed", () => {
    // `invoicedAmount` is optional on HistoryJob — frozen fixtures in
    // 305.test.tsx and 546.test.tsx omit it. £0.00 would be a worse answer
    // than the quote total on a job that plainly has an unpaid invoice.
    const bare = job({ invoicedAmount: undefined, collectedAmount: undefined });

    expect(rowAmount(bare)).toBe(1740);
  });
});
