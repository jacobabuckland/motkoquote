/**
 * @vitest-environment happy-dom
 */

// PASS-12 CRITICAL 2: the mark-as-paid dialog told a contractor his closed job
// was still open.
//
// Reported 16 Sep on a £2,376.00 job whose deposit was 100% of the total. The
// confirmation read:
//
//   "This records the £2,376.00 deposit as paid. The rest of the job stays
//    open, and reminders to QA continue for the balance."
//
// There is no rest and no balance. Pressing the button closed everything
// correctly and the banner seconds later said so — "the job is now closed and
// reminders have been stopped. Nothing else needs you." So the app contradicted
// itself inside one interaction, and the half that lies is the half a
// contractor reads BEFORE deciding whether to press.
//
// The cause was a branch on the invoice TYPE alone:
//
//   invoiceType === "deposit" ? <partial copy> : <closing copy>
//
// with nothing comparing the deposit to the total. The banner was already
// right, because it asks deriveJobState — which carries #739's settled-deposit
// rule and #782's resolveDeposit. This asked a string.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarkAsPaidButton } from "@/app/jobs/[id]/mark-as-paid-button";

afterEach(cleanup);

const openDialog = () => {
  fireEvent.click(screen.getByRole("button", { name: /mark as paid/i }));
};

describe("the mark-as-paid confirmation", () => {
  it("does not promise a balance when the deposit IS the whole job", () => {
    render(
      <MarkAsPaidButton
        invoiceId="inv_1"
        jobId="job_1"
        customerName="Dee"
        freeJobsRemaining={0}
        quoteTotal={2376}
        invoiceType="deposit"
        invoiceAmount={2376}
      />,
    );
    openDialog();

    const body = document.body.textContent ?? "";
    expect(body).not.toContain("The rest of the job stays open");
    expect(body).not.toContain("continue for the balance");
  });

  it("says the job closes instead", () => {
    render(
      <MarkAsPaidButton
        invoiceId="inv_1"
        jobId="job_1"
        customerName="Dee"
        freeJobsRemaining={0}
        quoteTotal={2376}
        invoiceType="deposit"
        invoiceAmount={2376}
      />,
    );
    openDialog();

    expect(document.body.textContent ?? "").toContain("This closes the job");
  });

  it("STILL says the job stays open on a genuinely partial deposit", () => {
    // The guard that must not move. This copy is right — #739 put it there
    // after a £118.80 deposit on a £475.20 job was reported as closing it — and
    // silencing it everywhere would trade one wrong sentence for a worse one.
    render(
      <MarkAsPaidButton
        invoiceId="inv_1"
        jobId="job_1"
        customerName="Dee"
        freeJobsRemaining={0}
        quoteTotal={1860}
        invoiceType="deposit"
        invoiceAmount={315}
      />,
    );
    openDialog();

    const body = document.body.textContent ?? "";
    expect(body).toContain("The rest of the job stays open");
    expect(body).toContain("Dee");
  });

  it("reads as a closing invoice when it is one", () => {
    render(
      <MarkAsPaidButton
        invoiceId="inv_1"
        jobId="job_1"
        customerName="Dee"
        freeJobsRemaining={0}
        quoteTotal={1860}
        invoiceType="final"
        invoiceAmount={1545}
      />,
    );
    openDialog();

    expect(document.body.textContent ?? "").toContain("This closes the job");
  });

  it("does not treat a missing amount as covering the job", () => {
    // Absence is not "the deposit is everything". Answering yes on missing data
    // would tell a contractor a job is closed when nobody has paid for it,
    // which is the more expensive direction to be wrong in — so the dashboard
    // row, which passes no invoice amount, keeps the partial copy.
    render(
      <MarkAsPaidButton
        invoiceId="inv_1"
        jobId="job_1"
        customerName="Dee"
        freeJobsRemaining={0}
        quoteTotal={1860}
        invoiceType="deposit"
      />,
    );
    openDialog();

    expect(document.body.textContent ?? "").toContain("The rest of the job stays open");
  });
});
