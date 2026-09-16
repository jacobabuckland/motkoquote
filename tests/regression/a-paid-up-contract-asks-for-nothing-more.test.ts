/**
 * A contract paid in full up front does not tell the customer a balance falls due.
 *
 * Clause 3's balance line was unconditional while only the deposit line was
 * gated, so a 100% deposit rendered both. On a £2,880 job reported 15 Sep the
 * header read "Total quote value £2,880.00 / Deposit £2,880.00 / Balance on
 * completion £0.00", and twelve lines below it clause 3 said:
 *
 *   - **Deposit:** £2,880.00, payable to confirm the booking…
 *   - **Balance:** the remainder is due on completion. 7 days.
 *
 * The customer pays for the whole job in advance, then signs a document saying
 * they owe more within a week of completion. A cautious homeowner rings up
 * about it; an awkward one reads it as grounds to argue the £2,880 was not the
 * whole price. The correct figure — £0.00 — was already on the page, six
 * inches above the sentence contradicting it.
 *
 * Asserted through the rendered document rather than on the variables alone,
 * because the defect was in the template's gating and a variable can be right
 * while the clause is still wrong.
 */

import { describe, expect, it } from "vitest";
import { buildContractVariables } from "@/lib/contracts/build-variables";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import type { LineItem } from "@/lib/schemas/job";

const LINE: LineItem = {
  description: "Reskim the community room",
  category: "labour",
  quantity: 1,
  unit: "job",
  unit_price: 2400,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
};

const contractor = {
  company_name: "Aspire Plastering Limited",
  company_number: "09117283",
  trade: "Plastering",
  vat_registered: true,
  vat_number: "GB123456789",
  business_profile: { default_payment_terms: "7 days" },
  payout_account_holder_name: null,
  payout_sort_code: null,
  payout_account_number: null,
};

/** The reported job: £2,400 + £480 VAT, and a deposit of the whole £2,880. */
const clauseThree = (depositAmount: number): string => {
  const vars = buildContractVariables({
    contractor: contractor as Parameters<typeof buildContractVariables>[0]["contractor"],
    customer: { name: "Sam Whitfield", contact: { email: "sam@example.com" } },
    lineItems: [LINE],
    quoteReference: "A1B2C3D4",
    depositAmount,
    jobInput: {} as Parameters<typeof buildContractVariables>[0]["jobInput"],
    recordedQuote: { total: 2880, subtotal: 2400, vat_amount: 480 },
  });

  const template = CONTRACT_TEMPLATES.find((t) => t.key === "standard_project");
  if (!template) throw new Error("standard_project template is missing");
  const body = template.body;
  const rendered = renderContractTemplate(body, vars);
  const start = rendered.indexOf("## 3. Payment");
  const end = rendered.indexOf("## 4.", start);
  return rendered.slice(start, end === -1 ? undefined : end);
};

describe("a deposit that is the whole price", () => {
  const clause = clauseThree(2880);

  it("does not say a remainder is due", () => {
    expect(clause).not.toContain("the remainder is due on completion");
  });

  it("says plainly that nothing further falls due", () => {
    expect(clause).toContain("the full price of the works");
  });

  it("still states the deposit itself", () => {
    expect(clause).toContain("£2,880.00");
  });
});

describe("a part deposit still promises the balance", () => {
  // The guard on the above. Most contracts are this shape, and removing the
  // balance sentence from them would be the more expensive mistake.
  const clause = clauseThree(720);

  it("says the remainder is due on completion", () => {
    expect(clause).toContain("the remainder is due on completion");
  });

  it("does not claim the deposit was the full price", () => {
    expect(clause).not.toContain("the full price of the works");
  });
});

describe("payment terms read as a sentence", () => {
  // Free prose — "7 days", "Net 30", "payment on completion" — so it cannot be
  // wrapped in "payable within X". It was appended bare, giving
  // "…due on completion. 7 days."
  it("does not append a bare fragment", () => {
    expect(clauseThree(720)).not.toContain("on completion. 7 days.");
  });

  it("names the terms as their own statement", () => {
    expect(clauseThree(720)).toContain("Payment terms: 7 days.");
  });
});
