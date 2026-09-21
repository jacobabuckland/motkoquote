/**
 * @vitest-environment happy-dom
 *
 * 20 Sep. A job whose timeline read captured / quote sent / accepted & signed /
 * invoiced, still showing:
 *
 *     2 details are missing from this quote
 *       who supplies the materials
 *       what's been agreed on cost
 *     Tap to review the quote and fill them in.
 *
 * Both were answered in documents the customer already holds: the quote carried
 * a `Materials £210.00` line and was accepted at £1,740.00, and clause 4 of the
 * signed contract reads "Materials will be supplied by: Contractor".
 *
 * `sow_json` is written once at intake and never reconciled against what the
 * job goes on to acquire, so the card had no way to know.
 *
 * THE INSTRUCTION IS THE PART THAT COSTS SOMETHING, not the inaccuracy.
 * Following it leads to an editor that opens with "Saving a change withdraws
 * their acceptance and re-issues it" — so the product routed a contractor
 * towards withdrawing a signed customer's acceptance to answer a question that
 * was not open.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IncompleteCaptureCard } from "@/app/jobs/[id]/incomplete-capture-card";
import type { Situation } from "@/lib/job-stages";

afterEach(cleanup);

const card = (situation: Situation | null, capEnded = true) =>
  render(
    <IncompleteCaptureCard
      unaskedRequired={["materials_supply", "pricing_mode"]}
      capEnded={capEnded}
      href="/jobs/job_1/quote"
      situation={situation}
    />,
  );

describe("once the customer has committed", () => {
  const committed: Situation[] = [
    "accepted_need_contract",
    "contract_sent",
    "signed_need_invoice",
    "work_complete",
    "invoice_unpaid",
    "invoice_overdue",
    "paid",
  ];

  for (const situation of committed) {
    it(`says nothing on a job at ${situation}`, () => {
      card(situation);

      expect(screen.queryByText(/details are missing/)).toBeNull();
    });
  }

  it("does not offer the cap notice either", () => {
    // The same reasoning: "worth reading the quote through before you send" is
    // advice about a send that already happened.
    card("paid", true);

    expect(screen.queryByText(/reached its limit/)).toBeNull();
  });
});

describe("while the quote is still the contractor's to change", () => {
  it("still asks on a draft", () => {
    card("draft_quote");

    expect(screen.getByText("2 details are missing from this quote")).toBeTruthy();
  });

  it("still asks on a quote out for acceptance, which can be re-issued freely", () => {
    card("quote_sent");

    expect(screen.getByText("2 details are missing from this quote")).toBeTruthy();
  });

  it("still asks where no quote has been derived yet", () => {
    card(null);

    expect(screen.getByText("2 details are missing from this quote")).toBeTruthy();
  });

  it("keeps naming the slots and the way to fix them", () => {
    card("draft_quote");

    expect(screen.getByRole("link").getAttribute("href")).toBe("/jobs/job_1/quote");
    expect(screen.getByText(/Tap to review the quote/)).toBeTruthy();
  });

  it("still shows the cap notice on its own on a draft", () => {
    render(
      <IncompleteCaptureCard
        unaskedRequired={[]}
        capEnded
        href="/jobs/job_1/quote"
        situation="draft_quote"
      />,
    );

    expect(screen.getByText("The call reached its limit")).toBeTruthy();
  });
});
