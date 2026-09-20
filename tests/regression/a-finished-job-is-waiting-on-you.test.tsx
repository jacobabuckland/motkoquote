/**
 * @vitest-environment happy-dom
 *
 * 20 SEP, from a dashboard screenshot. The hero read
 *
 *     Every invoice is paid
 *     £2,190.00of agreed work hasn't been invoiced yet. Raise it when the job's done.
 *
 * and "Your move" three inches below it read "Nothing needs you right now".
 *
 * Two defects in one view, and the second is the one that costs money.
 *
 * `totalUninvoicedBalance` counts any signed contract whose total exceeds what
 * has been invoiced. `dashboardSection` decided what needs the contractor — and
 * sent `work_complete` to `null`, so the state in which the final invoice is
 * ACTUALLY available was in no section at all. The inversion is the striking
 * part: `deriveInvoiceAmount` refuses a final invoice in `signed_need_invoice`,
 * which the section did hold, and allows it in `work_complete`, which it did
 * not. The section offered exactly the jobs that could not be invoiced.
 *
 * The space is a separate defect and is not reproducible under vitest's JSX
 * transform: that assertion passes against the unfixed component. It is a PIN
 * on the rendered output rather than a reproduction, which is why the fix is
 * the explicit `{" "}` the same file already uses for the greeting two branches
 * down — a no-op wherever the whitespace already survives.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { dashboardSection } from "@/lib/dashboard-sections";
import { canRaiseFinalInvoice } from "@/lib/invoice-amount";
import { DashboardHero } from "@/components/ui/dashboard-hero";

afterEach(cleanup);

const quote = {
  status: "accepted",
  sent_at: "2026-09-01",
  viewed_at: "2026-09-01",
  accepted_at: "2026-09-02",
  declined_at: null,
  total: 2190,
  deposit_pennies: null,
};

const signed = {
  id: "c1",
  status: "signed",
  sent_at: "2026-09-02",
  signed_at: "2026-09-03",
  deposit_pct: null,
};

const COMPLETED = "2026-09-18T09:00:00Z";
const NOW = Date.parse("2026-09-20T11:00:00Z");

const sectionFor = (workCompletedAt: string | null) =>
  dashboardSection(quote, signed, [], NOW, workCompletedAt, null);

describe("a job whose work the contractor has marked complete", () => {
  it("is something that needs them", () => {
    expect(
      sectionFor(COMPLETED),
      "the hero counts its money; the badge must agree it is theirs to act on",
    ).toBe("awaiting_invoice");
  });

  it("is in the section whose card can actually raise its invoice", () => {
    // The pairing that was inverted. Asserted together because either alone
    // reads as arbitrary: the section a job is offered in has to be the section
    // whose action the server will accept.
    expect(canRaiseFinalInvoice({ workCompletedAt: COMPLETED })).toBe(true);
    expect(sectionFor(COMPLETED)).toBe("awaiting_invoice");
  });
});

describe("what must not move", () => {
  it("keeps a signed job whose work is unfinished in the same section", () => {
    // It belongs there — the card offers Mark complete and says why the final
    // invoice is not available yet. Only the work_complete case was missing.
    expect(sectionFor(null)).toBe("awaiting_invoice");
  });

  it("still leaves an invoiced job out of both sections", () => {
    const invoiced = [
      {
        id: "i1",
        status: "sent",
        invoice_type: "final",
        due_date: "2026-09-30",
        created_at: "2026-09-19",
        paid_at: null,
      },
    ];
    expect(dashboardSection(quote, signed, invoiced, NOW, COMPLETED, null)).toBeNull();
  });

  it("still leaves an unsigned contract out of the invoice section", () => {
    const sent = { ...signed, status: "sent", signed_at: null };
    expect(dashboardSection(quote, sent, [], NOW, null, null)).not.toBe("awaiting_invoice");
  });
});

describe("the hero's uninvoiced line", () => {
  it("does not run the amount into the word after it", () => {
    render(<DashboardHero outstandingTotal={0} uninvoicedTotal={2190} />);

    expect(screen.getByText(/agreed work/).textContent).toContain(
      "£2,190.00 of agreed work",
    );
  });

  it("still names what to do about the figure", () => {
    render(<DashboardHero outstandingTotal={0} uninvoicedTotal={2190} />);

    expect(screen.getByText(/agreed work/).textContent).toContain(
      "Raise it when the job's done.",
    );
  });

  it("leaves the all-square state alone", () => {
    render(<DashboardHero outstandingTotal={0} uninvoicedTotal={0} />);

    expect(screen.getByText("You're all square")).toBeTruthy();
  });

  it("leaves the ledger figure alone when something is outstanding", () => {
    render(<DashboardHero outstandingTotal={840} uninvoicedTotal={2190} />);

    expect(screen.getByText("£840.00")).toBeTruthy();
  });
});
