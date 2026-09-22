/**
 * The dashboard and the job page answer the same question the same way.
 *
 * Both read one pure function. The defect is never in the function — it is in
 * giving it different inputs on the two surfaces, and the symptom is a job that
 * says one thing on its own page and another on the home screen.
 *
 * #780 taught `deriveSituation` to settle a 100% deposit from the quote's own
 * total, because `contracts.deposit_pct` is null on every deposit agreed on the
 * quote (16 of 42 contracts on production carry one at all; exactly one is
 * >= 100). `/jobs/[id]` was taught to pass `total` and `deposit_pennies`. The
 * dashboard was not — so it kept falling back to that null percentage and kept
 * filing a job PAID IN FULL under "accepted quotes awaiting invoice", with a
 * Final invoice for the whole job value pre-filled and one click from sending.
 *
 * Reported 15 Sep on job `8e89822a`: £2,880 settled by a 100% deposit, the job
 * page reading "Paid — nothing else needs you" at the same moment the dashboard
 * offered to bill it again.
 *
 * The rows below are that job and its neighbours, as production held them.
 */

import { describe, expect, it } from "vitest";
import { dashboardSection, sectionForQuoteRow } from "@/lib/dashboard-sections";
import { deriveSituation, type InvoiceState } from "@/lib/job-stages";

const SIGNED = {
  id: "c1",
  status: "signed",
  sent_at: "2026-09-15T09:00:00.000Z",
  signed_at: "2026-09-15T09:05:00.000Z",
  // Null exactly as production holds it for a deposit agreed on the quote.
  deposit_pct: null,
};

const accepted = (total: number, depositPennies: number) => ({
  status: "accepted",
  sent_at: "2026-09-15T08:00:00.000Z",
  viewed_at: "2026-09-15T08:30:00.000Z",
  accepted_at: "2026-09-15T08:45:00.000Z",
  declined_at: null,
  total,
  deposit_pennies: depositPennies,
});

const paidDeposit = (): InvoiceState => ({
  id: "i1",
  status: "paid",
  invoice_type: "deposit",
  due_date: null,
  created_at: "2026-09-15T09:10:00.000Z",
  paid_at: "2026-09-15T09:20:00.000Z",
});

describe("a job paid in full by a 100% deposit", () => {
  // £2,880 quoted, £2,880 taken as the deposit, deposit invoice paid.
  const quote = accepted(2880, 288000);
  const invoices = [paidDeposit()];

  it("is settled, and the job page says so", () => {
    expect(deriveSituation(quote, SIGNED, invoices, Date.now(), null).situation).toBe("paid");
  });

  it("is not offered for invoicing on the dashboard", () => {
    expect(
      dashboardSection(quote, SIGNED, invoices, Date.now(), null),
      "one click from billing the customer twice, for the full job value",
    ).toBeNull();
  });
});

describe("a job with a partial deposit is untouched", () => {
  // The guard on the above: £1,680 quoted, £420 taken. A balance is genuinely
  // outstanding, so the dashboard SHOULD still ask for the closing invoice.
  const quote = accepted(1680, 42000);
  const invoices = [paidDeposit()];

  it("still owes a closing invoice", () => {
    expect(deriveSituation(quote, SIGNED, invoices, Date.now(), null).situation).toBe(
      "signed_need_invoice",
    );
  });

  it("is still listed for invoicing", () => {
    expect(dashboardSection(quote, SIGNED, invoices, Date.now(), null)).toBe("awaiting_invoice");
  });
});

describe("work completed reaches both surfaces", () => {
  // Smaller blast radius — both answers point at the invoice — but it is the
  // same omission, and it was one argument away.
  const quote = accepted(1680, 42000);
  const invoices = [paidDeposit()];
  const completed = "2026-09-15T12:00:00.000Z";

  it("reads work_complete on the job page once the work is done", () => {
    expect(deriveSituation(quote, SIGNED, invoices, Date.now(), completed).situation).toBe(
      "work_complete",
    );
  });

  it("offers it on the dashboard too, which is the point of this file", () => {
    // WAS: "leaves the dashboard's awaiting-invoice list to the gating item",
    // asserting null. That deferral is retired as of 20 Sep 2026 (see the
    // commit retiring the two assertions in tests/acceptance/419.test.tsx).
    //
    // Keeping it would have been perverse HERE of all places: this file exists
    // to bind the two surfaces together, and the assertion pinned them apart —
    // the job page reading "Raise the final invoice to get paid" while the
    // dashboard counted the job as nothing to do.
    expect(dashboardSection(quote, SIGNED, invoices, Date.now(), completed)).toBe(
      "awaiting_invoice",
    );
  });
});

describe("the dashboard's own mapping carries every input", () => {
  // The tests above bind the pure function, which was never wrong. This binds
  // the MAPPING — the thing the page got wrong — so dropping a field from the
  // row fails here rather than on someone's home screen.
  const row = {
    status: "accepted",
    sent_at: "2026-09-15T08:00:00.000Z",
    viewed_at: "2026-09-15T08:30:00.000Z",
    accepted_at: "2026-09-15T08:45:00.000Z",
    declined_at: null,
    total: 2880,
    deposit_pennies: 288000,
    contract: SIGNED,
    invoices: [paidDeposit()],
    work_completed_at: null,
  };

  it("does not offer to re-bill a job settled by a 100% deposit", () => {
    expect(sectionForQuoteRow(row)).toBeNull();
  });

  it("reaches the same answer the job page reaches", () => {
    expect(sectionForQuoteRow(row)).toBe(
      dashboardSection(
        {
          status: row.status,
          sent_at: row.sent_at,
          viewed_at: row.viewed_at,
          accepted_at: row.accepted_at,
          declined_at: row.declined_at,
          total: row.total,
          deposit_pennies: row.deposit_pennies,
        },
        row.contract,
        row.invoices,
        Date.now(),
        row.work_completed_at,
      ),
    );
  });

  it("still lists a job with a real balance outstanding", () => {
    expect(
      sectionForQuoteRow({ ...row, total: 1680, deposit_pennies: 42000, invoices: [paidDeposit()] }),
    ).toBe("awaiting_invoice");
  });
});
