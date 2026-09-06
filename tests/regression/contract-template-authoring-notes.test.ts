// Regression: instructions addressed to the TRADESPERSON must not render in the
// agreement the customer is asked to sign.
//
// tests/acceptance/contract-template-annotations.test.ts already guards this
// class, but by three literal markers ("Use for:", "solicitor", "Draft
// template") drawn from the leak it was written for. Two more sat in
// MAINTENANCE_RECURRING for months and matched none of them: clause 2 told the
// author how to fill the schedule field ("Use this field to describe frequency
// and what each visit covers — e.g. …"), and clause 3 told them to "State
// clearly whether this is per visit, monthly, or annual". Both rendered to the
// customer, in the middle of a contractual clause.
//
// That acceptance file is frozen, so this widens the net alongside it rather
// than editing it. The phrases below are ones that can only ever be an
// instruction to whoever is filling the template in — no term between the
// Contractor and the Client is phrased that way.
//
// The parenthetical on Schedule A ("Complete and return only if you wish to
// cancel") reads similarly but is addressed to the CLIENT and is part of the
// statutory model cancellation form, so it is deliberately not listed.
import { describe, expect, it } from "vitest";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import type { ContractVariables } from "@/lib/schemas/contract";

const AUTHORING_PHRASES = [
  "Use this field",
  "State clearly whether",
  "in this field",
  "Use for:",
  "Draft template",
  "solicitor",
];

// Every variable the templates reference, populated, so each {{#section}}
// renders in its on-state and the scan covers the whole document.
const VARIABLES = {
  business_name: "Fenland Electrical Ltd",
  trading_name: "Fenland Electrical",
  business_structure: "a private limited company",
  company_number: "09876543",
  registered_address: "14 Mill Road, Wisbech, PE13 1AA",
  business_contact: "01945 000111",
  business_email: "meg@fenland-electrical.co.uk",
  business_phone: "01945 000111",
  trade: "Electrician",
  certifications: "NICEIC Approved Contractor",
  insurer_name: "Zurich",
  public_liability_cover: "£2,000,000",
  insurance_disclosed: "yes",
  client_name: "Mr A Barrett",
  client_address: "3 Elm Close, March, PE15 8QT",
  client_contact: "07700 900123",
  site_address: "3 Elm Close, March, PE15 8QT",
  quote_reference: "A1B2C3D4",
  contract_date: "19 Aug 2026",
  scope_of_work: "Full rewire of a three-bed semi.",
  exclusions: "Redecoration after making good.",
  labour_cost: "£1,700.00",
  materials_cost: "£620.00",
  subtotal: "£2,320.00",
  vat_amount: "£464.00",
  vat_number: "GB123456789",
  vat_registered: "yes",
  total_price: "£2,784.00",
  deposit_amount: "£556.80",
  payment_schedule: "Monthly, first visit 1 Sep 2026.",
  default_payment_terms: "Payment due within 14 days of invoice",
  payment_methods: "Bank transfer",
  bank_details: "sort code 04-00-04, account no. 12345678",
  materials_by: "the Contractor",
  materials_notes: "Cable and accessories to BS 7671.",
  start_date: "1 Sep 2026",
  estimated_duration: "5 working days",
  completion_date: "5 Sep 2026",
  access_arrangements: "Key collected from the neighbour at no. 5.",
  warranty_period: "12 months",
  building_regs_responsibility: "the Contractor",
  cancellation_start: "Yes",
  special_terms: "Parking permit to be provided by the Client.",
  governing_law: "England & Wales",
} as unknown as ContractVariables;

describe("no template body instructs the tradesperson", () => {
  it.each(CONTRACT_TEMPLATES.map((t) => t.key))("%s renders clean", (key) => {
    const template = CONTRACT_TEMPLATES.find((t) => t.key === key);
    const output = renderContractTemplate(template!.body, VARIABLES);

    for (const phrase of AUTHORING_PHRASES) {
      expect(output, `${key} leaked the authoring note "${phrase}"`).not.toContain(phrase);
    }
  });
});

describe("the guidance moved rather than being dropped", () => {
  // The two notes above were real guidance, not noise. `description` renders in
  // the contractor's template picker and never reaches a customer, so that is
  // where they belong — and a body scrubbed without them landing here would
  // pass the suite above while quietly losing the advice.
  it("maintenance_recurring tells the contractor what its schedule field is for", () => {
    const maintenance = CONTRACT_TEMPLATES.find((t) => t.key === "maintenance_recurring");

    expect(maintenance?.description).toContain("schedule field");
    expect(maintenance?.description).toContain("per visit, monthly or annual");
  });
});
