// The 13 Sep contract fixes reach no contract that already exists.
//
// `contracts.rendered_body` is written once, at creation, and never again. So
// #720 corrected the labour/materials split, the Materials clause opening, the
// `(**No**)` cancellation artefact and the ink execution block for contracts
// created from 13 Sep onward, and changed nothing at all about the rows in
// production — including one sitting in front of a customer who has not signed
// yet, showing `Labour £0.00` against the full price of an all-labour job.
//
// This covers the repair planner. The two things it must never do are the two
// things worth the most assertions here: it must not touch a signed contract,
// and it must not restate a contract whose quote has moved underneath it.
import { describe, expect, it } from "vitest";
import {
  materialsStatementFor,
  planContractRepair,
  type StoredContract,
} from "@/lib/contracts/repair-stored-contract";
import type { LineItem } from "@/lib/schemas/job";
import { getContractTemplate } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import type { ContractVariables } from "@/lib/schemas/contract";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Works",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 450,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

/** The reported shape: a fixed-price quote, collapsed to one `other` line. */
const FIXED_PRICE_LINES = [line({ description: "Plastering works", unit_price: 450 })];

const variables = (over: Partial<ContractVariables> = {}): ContractVariables => ({
  business_name: "Buckland Plastering Ltd",
  client_name: "A Customer",
  contract_date: "1 September 2026",
  quote_reference: "26208B87",
  scope_of_work: "Re-skim the hallway",
  // As stored by the old derivation: labour summed `category === "labour"`
  // (nothing, on a fixed-price quote) and materials took the remainder.
  labour_cost: "£0.00",
  materials_cost: "£450.00",
  subtotal: "£450.00",
  vat_amount: "£0.00",
  total_price: "£450.00",
  start_date: "To be confirmed",
  estimated_duration: "To be confirmed",
  completion_date: "To be confirmed",
  cancellation_start: "No",
  governing_law: "England & Wales",
  ...over,
});

const contract = (over: Partial<StoredContract> = {}): StoredContract => ({
  id: "26208b87",
  template_key: "standard_project",
  status: "sent",
  signed_at: null,
  rendered_body: "…the contract as stored, with Labour £0.00 in it…",
  variables_json: variables(),
  materials_by: null,
  line_items: FIXED_PRICE_LINES,
  vat_registered: false,
  ...over,
});

describe("the reported contract", () => {
  it("is repaired", () => {
    expect(planContractRepair(contract()).action).toBe("repair");
  });

  it("stops saying the labour was free", () => {
    // SUPERSEDED IN FORM, NOT IN SUBSTANCE. This asserted labour_cost £450.00,
    // from the rule where everything that was not materials became Labour. The
    // table is now one row per category, and this fixture is a fixed-price
    // quote whose three lines are all `other` — a single bucket, so clause 2
    // withholds the breakdown entirely and says nothing about composition.
    // The defect it guards is the same: the contract must not tell the customer
    // the labour was free and the plaster cost £450.
    const plan = planContractRepair(contract());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.renderedBody).not.toContain("| Labour | £0.00 |");
    expect(plan.renderedBody).not.toContain("| Materials | £450.00 |");
  });

  it("stops calling an all-labour job materials", () => {
    const plan = planContractRepair(contract());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.variables.materials_cost).toBe("£0.00");
  });

  it("still charges exactly what it charged — this moves no money", () => {
    const plan = planContractRepair(contract());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.variables.total_price).toBe("£450.00");
    expect(plan.variables.subtotal).toBe("£450.00");
  });

  it("names what it is fixing, for the operator's log", () => {
    // "labour/materials split" became "price table" when the table gained a row
    // per category: this fixture's stored Labour was ALREADY £0.00, so watching
    // labour_cost alone reported nothing while £450 moved off the Materials row.
    const plan = planContractRepair(contract());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.fixes).toContain("price table");
  });
});

describe("what it must never touch", () => {
  it("refuses a signed contract — that document is the agreement", () => {
    const plan = planContractRepair(contract({ signed_at: "2026-09-10T00:00:00Z" }));
    expect(plan).toEqual({ action: "skip", id: "26208b87", reason: "signed" });
  });

  it("refuses one marked signed even with no timestamp", () => {
    const plan = planContractRepair(contract({ status: "signed", signed_at: null }));
    expect(plan).toEqual({ action: "skip", id: "26208b87", reason: "signed" });
  });

  it("refuses when the quote has moved since the contract was sent", () => {
    // The contract was priced at £450. The quote now says £600 — so these are
    // not the lines this contract was built from, and splitting them would
    // restate a document the customer already holds.
    const plan = planContractRepair(
      contract({ line_items: [line({ unit_price: 600 })] }),
    );
    expect(plan).toEqual({ action: "skip", id: "26208b87", reason: "quote-moved" });
  });

  it("refuses an erased account's contract", () => {
    expect(planContractRepair(contract({ rendered_body: null }))).toEqual({
      action: "skip",
      id: "26208b87",
      reason: "erased",
    });
  });

  it("refuses when the line items could not be read", () => {
    expect(planContractRepair(contract({ line_items: null }))).toEqual({
      action: "skip",
      id: "26208b87",
      reason: "no-line-items",
    });
  });

  it("refuses when there are no stored variables to repair from", () => {
    expect(planContractRepair(contract({ variables_json: null }))).toEqual({
      action: "skip",
      id: "26208b87",
      reason: "no-variables",
    });
  });
});

describe("everything else in the contract is passed through, not rebuilt", () => {
  it("keeps the contract's own date rather than re-dating it to today", () => {
    const plan = planContractRepair(contract());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.variables.contract_date).toBe("1 September 2026");
  });

  it("changes only the variables the defects touch, plus the table's own controls", () => {
    const stored = variables();
    const plan = planContractRepair(contract({ variables_json: stored }));
    if (plan.action !== "repair") throw new Error("expected a repair");
    const changed = Object.keys({ ...stored, ...plan.variables }).filter(
      (key) => stored[key] !== plan.variables[key],
    );
    // The last three are NOT a widening of what this script rewrites — they are
    // what stops it deleting rows. No stored row has them, the renderer reads
    // absent as false, and without deriving them here a repair strips Labour,
    // Materials and VAT out of clause 2. That this list read as three while the
    // controls existed in the template is what the defect looked like from
    // inside the suite.
    // `labour_cost` is NOT in this list, and that is the change: the stored
    // contract already said Labour £0.00, and what moved was £450 coming off
    // Materials onto Other works. Watching labour_cost alone saw nothing.
    expect(changed.sort()).toEqual([
      "callout_cost",
      "charged_vat",
      "materials_cost",
      "materials_statement",
      "other_cost",
      "provisional_cost",
      "show_callout",
      "show_labour",
      "show_materials",
      "show_other",
      "show_provisional",
      "show_travel",
      "travel_cost",
      "vat_row_label",
    ]);
  });
});

describe("the materials clause opening", () => {
  it("names the party when the contract recorded one", () => {
    const plan = planContractRepair(contract({ materials_by: "the Contractor" }));
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.variables.materials_statement).toBe(
      "Materials will be supplied by: **the Contractor**.",
    );
  });

  it("points at the scope rather than inventing an obligation when it did not", () => {
    // Asserting "the Contractor" when nobody said so would create a duty on a
    // document the customer signs.
    expect(materialsStatementFor(null)).toBe(
      "Responsibility for supplying materials is as set out in the scope of work in clause 1.",
    );
    expect(materialsStatementFor(null)).not.toMatch(/Contractor/);
  });
});

describe("a contract that is already correct", () => {
  it("is skipped rather than rewritten", () => {
    // Render it exactly as the current code would, then hand that back as the
    // stored body: there is nothing to do.
    const repaired = {
      ...variables({ labour_cost: "£450.00", materials_cost: "£0.00" }),
      materials_statement: materialsStatementFor(null),
    };
    const body = renderContractTemplate(getContractTemplate("standard_project").body, repaired);
    const plan = planContractRepair(
      contract({ variables_json: repaired, rendered_body: body }),
    );
    expect(plan).toEqual({ action: "skip", id: "26208b87", reason: "already-correct" });
  });
});

describe("the repaired body itself", () => {
  it("no longer carries the ink execution block", () => {
    const plan = planContractRepair(contract());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.renderedBody).not.toMatch(/\*\*Signed by the Contractor:\*\*/);
  });

  it("no longer carries the (**No**) cancellation artefact", () => {
    const plan = planContractRepair(contract());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.renderedBody).not.toMatch(/\(\*\*No\*\*\)/);
  });

  it("stops claiming £450 of MATERIALS where the customer reads it", () => {
    // This used to assert the repaired body printed "Labour £450.00" — the
    // corrected side of the inverted derivation. D10 superseded that on
    // 14 Sep and Jacob approved it: these lines are all `other`, which is the
    // editor's default Kind, so calling the whole £450 labour is a confident
    // claim about a composition nobody stated. The repair's actual job here is
    // to stop the contract saying £450 of materials, and it still does that.
    const plan = planContractRepair(contract());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.renderedBody).not.toMatch(/Materials[^\n]*£450\.00/);
    expect(plan.renderedBody).not.toMatch(/\|\s*Labour\s*\|/);
    expect(plan.renderedBody).not.toMatch(/\|\s*Materials\s*\|/);
    // What it does still say, which is everything it actually knows.
    expect(plan.renderedBody).toMatch(/£450\.00/);
  });
});

describe("a genuinely mixed quote splits the way a customer would expect", () => {
  it("puts materials on the materials row and everything else on labour", () => {
    const mixed = [
      line({ description: "Plastering", category: "labour", quantity: 3, unit: "day", unit_price: 250 }),
      line({ description: "Plaster", category: "materials", quantity: 10, unit: "bag", unit_price: 12.5 }),
      line({ description: "Travel", category: "travel", quantity: 1, unit_price: 40 }),
    ];
    const plan = planContractRepair(
      contract({
        line_items: mixed,
        variables_json: variables({ subtotal: "£915.00", total_price: "£915.00" }),
      }),
    );
    if (plan.action !== "repair") throw new Error("expected a repair");
    // Each on its own row now. Travel used to be folded into Labour, making it
    // £790.00 — the £40 overstatement this change exists to remove.
    expect(plan.variables.labour_cost).toBe("£750.00");
    expect(plan.variables.materials_cost).toBe("£125.00");
    expect(plan.variables.travel_cost).toBe("£40.00");
  });
});

// The repair script must not DELETE rows from the contracts it repairs.
//
// The clause 2 table's controls (`show_labour`, `show_materials`, `charged_vat`,
// `vat_row_label`) did not exist when any stored row was written. Spreading
// `variables_json` alone leaves them absent, the renderer reads absent as
// false, and the script then stripped clause 2 down to
//
//     | Subtotal | £740.00 |
//     | **Total** | **£888.00** |
//
// on a contract with real materials and £148 of VAT — the amount and the VAT
// number gone from a priced document, by the tool whose job is correcting it.
describe("the price table survives a repair", () => {
  const mixed = [
    line({ description: "Labour", category: "labour", quantity: 1, unit_price: 600 }),
    line({ description: "Plaster", category: "materials", quantity: 1, unit_price: 140 }),
  ];
  const registered = () =>
    contract({
      line_items: mixed,
      vat_registered: true,
      variables_json: variables({
        labour_cost: "£600.00",
        materials_cost: "£140.00",
        subtotal: "£740.00",
        vat_amount: "£148.00",
        total_price: "£888.00",
        vat_registered: "yes",
        vat_number: "GB123456789",
      }),
    });

  it("keeps every row the contract's own variables evidence", () => {
    const plan = planContractRepair(registered());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.renderedBody).toContain("| Labour | £600.00 |");
    expect(plan.renderedBody).toContain("| Materials | £140.00 |");
    expect(plan.renderedBody).toContain("| VAT (VAT no. GB123456789) | £148.00 |");
  });

  it("reads the contract's own registration, not the contractor's current one", () => {
    // The rule the rest of this file follows: a registration toggled since the
    // contract was sent cannot change what the contract says.
    const plan = planContractRepair(registered());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.variables.charged_vat).toBe("yes");
    expect(plan.variables.show_labour).toBe("yes");
    expect(plan.variables.show_materials).toBe("yes");
  });

  it("still suppresses what the contract itself does not evidence", () => {
    // The default fixture: an unregistered trade, all-labour, £0.00 VAT.
    const plan = planContractRepair(contract());
    if (plan.action !== "repair") throw new Error("expected a repair");
    expect(plan.renderedBody).not.toContain("| Materials |");
    expect(plan.renderedBody).not.toMatch(/\|\s*VAT/);
  });

  it("leaves no template source in the repaired body", () => {
    for (const c of [registered(), contract()]) {
      const plan = planContractRepair(c);
      if (plan.action !== "repair") throw new Error("expected a repair");
      expect(plan.renderedBody.match(/{{[^}]*}}/g) ?? []).toEqual([]);
    }
  });
});
