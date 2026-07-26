import { describe, expect, it } from "vitest";
import { buildContractVariables } from "./build-variables";
import { renderContractTemplate } from "./render-template";
import { CONTRACT_TEMPLATES } from "./templates";
import type { BusinessProfile, ContractJobInput } from "@/lib/schemas/contract";
import type { LineItem } from "@/lib/schemas/job";

const baseContractor = {
  company_name: "Acme Building Ltd",
  company_number: null,
  trade: "Builder",
  vat_registered: false,
  vat_number: null,
  business_profile: {} as BusinessProfile,
  payout_account_holder_name: null as string | null,
  payout_sort_code: null as string | null,
  payout_account_number: null as string | null,
  payout_details_complete: false,
};

const build = (contractor: typeof baseContractor) =>
  buildContractVariables({
    contractor,
    customer: { name: "Jane Client", contact: {} },
    lineItems: [],
    quoteReference: "ABCD1234",
    depositAmount: null,
    jobInput: {} as ContractJobInput,
  });

describe("buildContractVariables — payout bank details", () => {
  it("formats the structured payout account into bank_details", () => {
    const vars = build({
      ...baseContractor,
      payout_account_holder_name: "Acme Building Ltd",
      payout_sort_code: "123456",
      payout_account_number: "12345678",
      payout_details_complete: true,
    });
    expect(vars.bank_details).toBe(
      "Acme Building Ltd, sort code 12-34-56, account no. 12345678",
    );
  });

  it("leaves bank_details empty when payout details are incomplete", () => {
    const vars = build(baseContractor);
    expect(vars.bank_details).toBe("");
  });

  it("falls back to legacy free-text bank_details when no payout account is set", () => {
    const vars = build({
      ...baseContractor,
      business_profile: { bank_details: "Pay by cheque to Acme" } as BusinessProfile,
    });
    expect(vars.bank_details).toBe("Pay by cheque to Acme");
  });

  it("prefers the structured payout account over legacy free-text", () => {
    const vars = build({
      ...baseContractor,
      business_profile: { bank_details: "Old details" } as BusinessProfile,
      payout_account_holder_name: "Acme Building Ltd",
      payout_sort_code: "998877",
      payout_account_number: "00112233",
      payout_details_complete: true,
    });
    expect(vars.bank_details).toBe(
      "Acme Building Ltd, sort code 99-88-77, account no. 00112233",
    );
  });
});

// A single materials line big enough to force four-digit money on the
// contract (subtotal £6,500, VAT £1,300, total £7,800) — the exact shape
// that surfaced the "£6500.00" (un-grouped) and "Not specified" review
// findings. VAT-registered so vat_amount is non-empty too.
const fourFigureLineItems: LineItem[] = [
  {
    description: "Full bathroom refit",
    category: "materials",
    quantity: 1,
    unit: "job",
    unit_price: 6500,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
  },
];

// Renders every template with a blank job input and a four-figure total, so
// one assertion covers "no clause leaks a placeholder" across all of them.
const renderAllTemplates = (jobInput: ContractJobInput): string[] => {
  const vars = buildContractVariables({
    contractor: { ...baseContractor, vat_registered: true },
    customer: { name: "Jane Client", contact: {} },
    lineItems: fourFigureLineItems,
    quoteReference: "ABCD1234",
    depositAmount: null,
    jobInput,
  });
  return CONTRACT_TEMPLATES.map((t) => renderContractTemplate(t.body, vars));
};

describe("contract rendering — money and blank-clause guards", () => {
  it("never emits an un-grouped four-digit money string", () => {
    // formatGBP groups thousands ("£6,500.00"), so a bare £6500 in the output
    // means some amount bypassed the formatter — exactly the review's #1.2.
    for (const body of renderAllTemplates({} as ContractJobInput)) {
      expect(body).not.toMatch(/£\d{4,}/);
    }
  });

  it("never prints 'Not specified' on a rendered contract", () => {
    for (const body of renderAllTemplates({} as ContractJobInput)) {
      expect(body).not.toContain("Not specified");
    }
  });

  it("omits blank clauses instead of leaving empty headings or '****'", () => {
    for (const body of renderAllTemplates({} as ContractJobInput)) {
      // Empty bold-wrapped values would render as literal asterisks.
      expect(body).not.toContain("****");
      // The exclusions heading (#19) must disappear when there are none.
      expect(body).not.toMatch(/\*\*(Not included|Excluded[^:]*):\*\*\s*$/m);
    }
  });

  it("still renders the fields when the job supplies them", () => {
    const [smallWorks] = renderAllTemplates({
      exclusions: "Making good decorative finishes",
      warranty_period: "12 months",
      materials_by: "the Contractor",
    } as ContractJobInput);
    expect(smallWorks).toContain("Making good decorative finishes");
    expect(smallWorks).toContain("12 months");
    expect(smallWorks).toContain("the Contractor");
  });
});
