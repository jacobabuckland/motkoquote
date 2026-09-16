// The tracker dated a row that had not happened.
//
// Reported 14 Sep on two part-paid jobs. With a £118.80 deposit settled and the
// £356.40 balance not yet invoiced, the rows rendered:
//
//     ✓ Job captured — 14 Sept 2026
//     ✓ Quote sent — 14 Sept 2026
//     ✓ Accepted & signed — 14 Sept 2026
//     ◉ Invoiced — "Your move"        (unticked, named as the current action)
//     ○ Paid — 14 Sept 2026           (empty circle, carrying a date)
//
// A dated row BELOW the outstanding one says the job was paid before it was
// invoiced. The tick and the pointer come from deriveStages; the date came
// straight through beside them, so the two could disagree.
//
// deriveStages is right to return a date for any stage with evidence behind it
// — `paid.date` is the first settled invoice's paid_at, which on a job that
// took a deposit is the DEPOSIT. The pipeline stepper already gates on state
// before printing it. The timeline did not.
import { describe, expect, it } from "vitest";
import { deriveJobState } from "@/lib/job-stages";
import { buildJobTimeline } from "@/lib/job-timeline";

const QUOTE = {
  status: "accepted",
  sent_at: "2026-09-14T09:00:00.000Z",
  viewed_at: "2026-09-14T09:30:00.000Z",
  accepted_at: "2026-09-14T10:00:00.000Z",
  declined_at: null,
};

const CONTRACT = {
  id: "contract-1",
  status: "signed",
  sent_at: "2026-09-14T10:30:00.000Z",
  signed_at: "2026-09-14T11:00:00.000Z",
  deposit_pct: 25,
};

/** Tomas's job: the deposit is settled, the balance is not yet invoiced. */
const SETTLED_DEPOSIT_ONLY = [
  {
    id: "inv-deposit",
    status: "paid",
    invoice_type: "deposit",
    due_date: "2026-09-21",
    created_at: "2026-09-14T11:05:00.000Z",
    paid_at: "2026-09-14T11:30:00.000Z",
  },
];

const rowsFor = (invoices: typeof SETTLED_DEPOSIT_ONLY) => {
  const state = deriveJobState(QUOTE, CONTRACT, invoices, Date.parse("2026-09-14T12:00:00.000Z"));
  return buildJobTimeline({
    stages: state.stages,
    move: state.move,
    capturedAt: "2026-09-14T08:00:00.000Z",
    customerFirstName: "Tomas",
    overdue: false,
  });
};

const row = (rows: ReturnType<typeof rowsFor>, key: string) => rows.find((r) => r.key === key);

describe("a part-paid job", () => {
  it("does not date the Paid row while the job is not paid", () => {
    const paid = row(rowsFor(SETTLED_DEPOSIT_ONLY), "paid");
    expect(paid?.state).not.toBe("complete");
    expect(paid?.date).toBeNull();
  });

  it("DATES the Invoiced row, because an invoice genuinely was raised", () => {
    // REVERSED 15 Sep by the pass-7 review, and the reversal is the point of
    // this comment surviving.
    //
    // It read `not.toBe("complete")` and `date).toBeNull()`, on the reasoning
    // that a settled deposit does not make the job invoiced. True of the JOB,
    // false of the ROW: the deposit invoice was raised, emailed, given a due
    // date and attached to the chaser. Denying it put "○ Invoiced" with no
    // date on the same screen as "Deposit · £756.00 — Due 22 Sept" and
    // "Invoiced (net) £630.00", on three separate live jobs.
    //
    // "The job is not fully invoiced" is carried by the Paid row and by the
    // status panel's own copy, neither of which this touches.
    const invoiced = row(rowsFor(SETTLED_DEPOSIT_ONLY), "invoiced");
    expect(invoiced?.state).toBe("complete");
    expect(invoiced?.date).not.toBeNull();
  });

  it("never carries a date on a row below an unticked one", () => {
    // The reported shape, stated generally: once a row is incomplete, nothing
    // after it may claim a date.
    const rows = rowsFor(SETTLED_DEPOSIT_ONLY);
    const firstIncomplete = rows.findIndex((r) => r.state !== "complete" && r.state !== "forced");
    expect(firstIncomplete).toBeGreaterThan(-1);
    for (const later of rows.slice(firstIncomplete)) {
      expect(later.date, `${later.label} is dated but not done`).toBeNull();
    }
  });

  it("still dates the rows that DID happen", () => {
    // The fix must not strip the timeline of everything it legitimately knows.
    const rows = rowsFor(SETTLED_DEPOSIT_ONLY);
    expect(row(rows, "captured")?.date).toBeTruthy();
    expect(row(rows, "quote_sent")?.date).toBeTruthy();
    expect(row(rows, "accepted_signed")?.date).toBeTruthy();
  });
});

describe("a fully settled job", () => {
  it("dates Paid, because it happened", () => {
    const rows = rowsFor([
      ...SETTLED_DEPOSIT_ONLY,
      {
        id: "inv-final",
        status: "paid",
        invoice_type: "final",
        due_date: "2026-09-28",
        created_at: "2026-09-14T11:40:00.000Z",
        paid_at: "2026-09-14T11:50:00.000Z",
      },
    ]);
    expect(row(rows, "paid")?.state).toBe("complete");
    expect(row(rows, "paid")?.date).toBeTruthy();
    expect(row(rows, "invoiced")?.date).toBeTruthy();
  });
});
