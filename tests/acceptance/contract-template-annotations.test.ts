// Acceptance: internal authoring annotations must not render in the contract
// a customer is asked to sign.
//
// Every template body opened with a three-line preamble — a "Use for:" line
// telling the tradesperson when to pick this template, and an italic line
// declaring the document a "Draft template — have a solicitor review before
// use". Both are markdown inside `body`, so the renderer faithfully emitted
// them to the customer. The second is also factually stale: the wording has
// been through legal review.
//
// The fix is at source, not at render, and that is the opposite of the
// established pattern for the sibling leak on the quote PDF — see the card's
// prior-art section. It is correct here because nothing is shared: `body`'s
// only consumer is the customer-facing contract, while the contractor's
// selection guidance lives in the separate `description` field.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import { parseContractMarkdown } from "@/lib/contracts/markdown";
import type { ContractVariables } from "@/lib/schemas/contract";

const INTERNAL_MARKERS = ["Use for:", "solicitor", "Draft template"];

// Populated for every variable the templates reference, so each {{#section}}
// renders in its on-state and the assertions cover the whole document.
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
  payment_schedule: "30% deposit, balance on completion.",
  default_payment_terms: "Payment due within 14 days of invoice",
  payment_methods: "Bank transfer",
  bank_details: "Fenland Electrical Ltd, sort code 04-00-04, account no. 12345678",
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

const rendered = (body: string) => renderContractTemplate(body, VARIABLES);

describe("stored template bodies carry no internal annotation", () => {
  it.each(INTERNAL_MARKERS)("no body contains %s", (marker) => {
    const offenders = CONTRACT_TEMPLATES.filter((t) => t.body.includes(marker)).map((t) => t.key);
    expect(offenders).toEqual([]);
  });

  it.each(CONTRACT_TEMPLATES.map((t) => t.key))(
    "%s still states its jurisdiction — a real contractual term",
    (key) => {
      const template = CONTRACT_TEMPLATES.find((t) => t.key === key);
      expect(template?.body).toContain("Jurisdiction: England & Wales");
    },
  );
});

describe("rendered contracts carry no internal annotation", () => {
  it.each(CONTRACT_TEMPLATES.map((t) => t.key))("%s renders clean", (key) => {
    const template = CONTRACT_TEMPLATES.find((t) => t.key === key);
    const output = rendered(template!.body);
    for (const marker of INTERNAL_MARKERS) {
      expect(output, `${key} leaked "${marker}"`).not.toContain(marker);
    }
  });

  it.each(CONTRACT_TEMPLATES.map((t) => t.key))(
    "%s opens heading → jurisdiction → rule, with no annotation between",
    (key) => {
      const template = CONTRACT_TEMPLATES.find((t) => t.key === key);
      const blocks = parseContractMarkdown(rendered(template!.body));

      expect(blocks[0]?.type).toBe("heading");
      expect(blocks[1]?.type).toBe("paragraph");

      // Asserted as an EXACT match, not a `toContain`. The annotation sat on
      // the line directly above the jurisdiction line with no blank between
      // them, so markdown folded both into this one paragraph — a `toContain`
      // check passes straight through a reintroduced annotation and asserts
      // nothing. Verified by mutation.
      const jurisdiction = blocks[1] as { inlines: { text: string }[] };
      expect(jurisdiction.inlines.map((i) => i.text).join("").trim()).toBe(
        "Jurisdiction: England & Wales.",
      );
      expect(blocks[2]?.type).toBe("hr");
    },
  );

  it.each(CONTRACT_TEMPLATES.map((t) => t.key))(
    "%s substitutes every variable and leaves no unbalanced section tag",
    (key) => {
      const template = CONTRACT_TEMPLATES.find((t) => t.key === key);
      const output = rendered(template!.body);

      // A section tag left behind means the preamble edit broke a {{#x}}…{{/x}}
      // pair, which would silently swallow or duplicate a clause.
      expect(output).not.toContain("{{");
      expect(output).not.toContain("}}");
      expect(output).toMatch(/^# .+/);
    },
  );
});

describe("the authoring guidance survives, off the customer document", () => {
  it("gives every template a non-empty, distinct description", () => {
    const descriptions = CONTRACT_TEMPLATES.map((t) => t.description);
    expect(descriptions.every((d) => d.trim().length > 0)).toBe(true);
    expect(new Set(descriptions).size).toBe(CONTRACT_TEMPLATES.length);
  });

  it("keeps the registration-implication warning on the regulated template", () => {
    const template = CONTRACT_TEMPLATES.find((t) => t.key === "regulated_certified_works");
    expect(template?.description).toContain("registration");
  });

  it("keeps the bolt-on guidance that only the body used to carry", () => {
    const template = CONTRACT_TEMPLATES.find((t) => t.key === "regulated_certified_works");
    expect(template?.description).toContain("compliance clauses");
  });
});

describe("the file no longer tells its next reader the templates are drafts", () => {
  const source = readFileSync(
    path.join(__dirname, "..", "..", "src", "lib", "contracts", "templates.ts"),
    "utf8",
  );
  const header = source.slice(0, source.indexOf("const SMALL_WORKS"));

  it("does not describe them as unreviewed drafts", () => {
    expect(header).not.toContain("Draft templates");
    expect(header).not.toContain("a solicitor should review");
  });

  it("records that they have been reviewed, so the render fix is not undone", () => {
    expect(header).toContain("REVIEWED");
  });
});
