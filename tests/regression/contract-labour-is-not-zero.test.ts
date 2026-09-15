// A fixed-price contract said the labour was free.
//
// Reported 13 Sep against a live £450 contract for a three-room plaster
// re-skim. Clause 2 printed:
//
//     | Labour    | £0.00   |
//     | Materials | £450.00 |
//
// A customer reads that as "he's charging me nothing to do the work and £450
// for bags of plaster". It invites a price challenge, it is false, and it
// misdescribes the supply.
//
// The cause was which side of the two-row table was DERIVED. `labourCost`
// summed `category === "labour"` and materials took the remainder — so every
// other category fell into Materials: `travel`, `callout`, and `other`.
//
// `other` is what a fixed-price quote collapses to (applyPricingMode builds the
// single works line with that category), which made this every fixed-price
// contract rather than an edge case. Materials is now the summed side and
// labour takes the remainder.
import { describe, expect, it } from "vitest";
import { buildContractVariables } from "@/lib/contracts/build-variables";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import { getContractTemplate } from "@/lib/contracts/templates";
import type { LineItem } from "@/lib/schemas/job";
import type { ContractJobInput } from "@/lib/schemas/contract";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Work",
  category: "labour",
  quantity: 1,
  unit: "job",
  unit_price: 100,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

const CONTRACTOR = {
  company_name: "Aspire Plastering Limited",
  company_number: "09117283",
  trade: "Plastering",
  vat_registered: false,
  vat_number: null,
  business_profile: {},
  payout_account_holder_name: null,
  payout_sort_code: null,
  payout_account_number: null,
  payout_details_complete: false,
  stripe_account_id: null,
  stripe_payouts_enabled: false,
  stripe_pay_by_bank_enabled: false,
};

const JOB_INPUT = {} as ContractJobInput;

const build = (lineItems: LineItem[]) =>
  buildContractVariables({
    contractor: CONTRACTOR,
    customer: { name: "A Customer", contact: {} },
    lineItems,
    quoteReference: "F49D1260",
    depositAmount: null,
    jobInput: JOB_INPUT,
  });

/** Clause 2 as it actually renders, through the real section engine. */
const renderClauseTwo = (variables: ReturnType<typeof buildContractVariables>): string =>
  renderContractTemplate(getContractTemplate("standard_project").body, variables);

describe("the fixed-price collapse, which is what was reported", () => {
  // What applyPricingMode actually produces: one works line, category "other".
  const collapsed = [
    line({ description: "Plastering works", category: "other", unit_price: 450 }),
  ];

  // SUPERSEDED IN FORM, NOT IN SUBSTANCE (15 Sep). These asserted that the
  // whole works line lands on Labour, from the rule where everything that was
  // not materials became labour. That rule also called travel, call-out and
  // provisional sums labour on a signed contract, so the table is now one row
  // per category — and a single-category quote like this one shows no
  // breakdown at all rather than a bucket it has no evidence for. The defect
  // guarded is unchanged: the contract must not tell the customer the labour
  // was free and the plaster cost £450.
  it("does not tell the customer the labour was free", () => {
    const v = build(collapsed);
    expect(renderClauseTwo(v)).not.toContain("| Labour | £0.00 |");
  });

  it("does not call an undifferentiated works line materials", () => {
    const v = build(collapsed);
    const rendered = renderClauseTwo(v);
    expect(rendered).not.toContain("| Materials | £450.00 |");
    // And says nothing about composition, having no basis for a claim.
    expect(rendered).not.toContain("| Materials |");
    expect(rendered).toContain("| Subtotal | £450.00 |");
  });
});

describe("an itemised quote still splits where the split is real", () => {
  const itemised = [
    line({ description: "Labour", category: "labour", unit_price: 1700 }),
    line({ description: "Plaster and beading", category: "materials", unit_price: 620 }),
  ];

  it("reports each side from its own lines", () => {
    const v = build(itemised);
    expect(v.labour_cost).toBe("£1,700.00");
    expect(v.materials_cost).toBe("£620.00");
  });
});

describe("the categories that are neither", () => {
  it("counts travel and callout as the contractor's charge, not as materials", () => {
    // Both are the contractor's own time and cost. Billing them to the customer
    // as "Materials" was the same defect in a quieter form.
    const v = build([
      line({ description: "Labour", category: "labour", unit_price: 300 }),
      line({ description: "Travel", category: "travel", unit_price: 40 }),
      line({ description: "Call-out", category: "callout", unit_price: 60 }),
    ]);
    // Each on its own row now, rather than travel and call-out being folded
    // into Labour to make £400.00.
    expect(v.materials_cost).toBe("£0.00");
    expect(v.labour_cost).toBe("£300.00");
    expect(v.travel_cost).toBe("£40.00");
    expect(v.callout_cost).toBe("£60.00");
  });

  it("keeps the rows adding up to the subtotal", () => {
    const v = build([
      line({ description: "Labour", category: "labour", unit_price: 1000 }),
      line({ description: "Materials", category: "materials", unit_price: 250 }),
      line({ description: "Travel", category: "travel", unit_price: 75 }),
    ]);
    // Every row, not two: the breakdown must still foot to the subtotal.
    expect(v.labour_cost).toBe("£1,000.00");
    expect(v.materials_cost).toBe("£250.00");
    expect(v.travel_cost).toBe("£75.00");
    expect(v.subtotal).toBe("£1,325.00");
    const rows = [v.labour_cost, v.materials_cost, v.travel_cost, v.callout_cost, v.other_cost, v.provisional_cost]
      .map((a) => Number(a.replace(/[£,]/g, "")));
    expect(Math.round(rows.reduce((a, b) => a + b, 0) * 100) / 100).toBe(1325);
  });
});

describe("the Materials clause always has an opening sentence", () => {
  // Reported 13 Sep: with no supplier named the clause opened mid-thought on
  // its second paragraph — "Materials supplied by the Contractor remain the
  // Contractor's property…". Present on one live contract, absent on another,
  // from the same template.
  it("says where the answer lives when no supplier is named", () => {
    const v = build([line({ unit_price: 450 })]);
    expect(v.materials_statement).toBe(
      "Responsibility for supplying materials is as set out in the scope of work in clause 1.",
    );
  });

  it("names the supplier when one is set", () => {
    const v = buildContractVariables({
      contractor: CONTRACTOR,
      customer: { name: "A Customer", contact: {} },
      lineItems: [line({ unit_price: 450 })],
      quoteReference: "F49D1260",
      depositAmount: null,
      jobInput: { materials_by: "the Contractor" } as ContractJobInput,
    });
    expect(v.materials_statement).toBe("Materials will be supplied by: **the Contractor**.");
  });

  it("never leaves the sentence empty", () => {
    expect(build([line({ unit_price: 1 })]).materials_statement.length).toBeGreaterThan(0);
  });
});
