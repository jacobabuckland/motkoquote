import { describe, expect, it } from "vitest";
import { buildContractVariables } from "./build-variables";
import type { BusinessProfile, ContractJobInput } from "@/lib/schemas/contract";

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
