/**
 * The site address is captured once and must reach every document that names
 * it — and where it genuinely was not captured, no document may invent it or
 * print the gap as a broken sentence.
 *
 * Three defects, one field. Found while auditing document validity on 8 Sep
 * 2026 against production: of the eighteen quotes ever sent from this account,
 * eleven carry no site address at all.
 *
 *   1. The job page — the ONLY route to "Send a contract to sign" — built its
 *      own contract prefill inline and passed neither the address nor the
 *      phone, while the dashboard's copy of the same form used the shared
 *      `contractPrefillFromJob` and passed both. Two constructions of one
 *      thing, and the one that matters was the poorer.
 *
 *   2. `SMALL_WORKS` interpolates `{{site_address}}` bare, in the middle of a
 *      sentence: "The Contractor agrees to carry out the following work at
 *      {{site_address}}:". Every other optional variable in that file is
 *      wrapped in a `{{#var}}` section for exactly this reason. With no
 *      address the clause renders as "…the following work at :" — on a
 *      contract somebody signs.
 *
 *   3. The statement of work prints "Same as customer address" when no address
 *      is present. There is no separate customer address anywhere in the SOW
 *      pipeline — `render-sow.ts` merges the one captured field into
 *      `site_address` — so the fallback asserts an equality between a thing
 *      that does not exist and another thing that does not exist.
 *
 * All three are about a document saying something untrue or malformed, so all
 * three are asserted against rendered output rather than against the code that
 * produces it.
 */

import { describe, expect, it } from "vitest";

import { contractPrefillFromJob } from "@/lib/contract-prefill";
import { buildContractVariables } from "@/lib/contracts/build-variables";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import { siteAddressLine } from "@/lib/pdf/site-address-line";
import type { BusinessProfile, ContractJobInput } from "@/lib/schemas/contract";
import type { LineItem } from "@/lib/schemas/job";

const CAPTURED_ADDRESS = "12 Example Road, Norwich, NR1 1AA";

const lineItems: LineItem[] = [
  {
    description: "Plastering to two bedrooms",
    category: "labour",
    quantity: 2,
    unit: "day",
    unit_price: 250,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
  },
];

const contractor = {
  company_name: "Acme Building Ltd",
  company_number: null,
  trade: "Builder",
  vat_registered: false,
  vat_number: null,
  business_profile: {} as BusinessProfile,
  payout_account_holder_name: null,
  payout_sort_code: null,
  payout_account_number: null,
  payout_details_complete: false,
  stripe_account_id: null,
  stripe_payouts_enabled: false,
  stripe_pay_by_bank_enabled: false,
};

const renderEveryTemplate = (jobInput: Partial<ContractJobInput>): string[] => {
  const variables = buildContractVariables({
    contractor,
    customer: { name: "Jane Client", contact: {} },
    lineItems,
    quoteReference: "ABCD1234",
    depositAmount: null,
    jobInput: jobInput as ContractJobInput,
  });
  return CONTRACT_TEMPLATES.map((t) => renderContractTemplate(t.body, variables));
};

describe("the captured site address reaches the contract form", () => {
  it("carries the address a customer row holds through to the site field", () => {
    const prefill = contractPrefillFromJob({
      customer: { contact: { address: CAPTURED_ADDRESS, phone: "07700 900000" } },
      extracted_json: null,
    });

    expect(prefill.site_address).toBe(CAPTURED_ADDRESS);
  });

  it("falls back to the address captured on the call when no customer row has one", () => {
    // A quote sent before the editor's address field existed leaves the row
    // blank while the SOW still holds what the contractor dictated. The
    // contract form must not open empty next to a statement of work that
    // already states the answer.
    const prefill = contractPrefillFromJob({
      customer: { contact: { phone: "07700 900000" } },
      extracted_json: null,
      sow: { site_address: CAPTURED_ADDRESS },
    });

    expect(prefill.site_address).toBe(CAPTURED_ADDRESS);
  });

  it("prefers the customer row over the call, since the row was confirmed at send", () => {
    const prefill = contractPrefillFromJob({
      customer: { contact: { address: CAPTURED_ADDRESS } },
      extracted_json: null,
      sow: { site_address: "A misheard address from the call" },
    });

    expect(prefill.site_address).toBe(CAPTURED_ADDRESS);
  });

  it("yields an empty, usable field when nothing anywhere holds an address", () => {
    // Empty string, never undefined: the form's inputs are controlled, and an
    // absent value must leave a usable empty box rather than an uncontrolled
    // input or placeholder text presented as captured data.
    expect(contractPrefillFromJob({ customer: null, extracted_json: null }).site_address).toBe("");
    expect(contractPrefillFromJob(null).site_address).toBe("");
  });
});

describe("a contract names the site, or says nothing — never 'at :'", () => {
  it("names the site in the work clause when an address is present", () => {
    const bodies = renderEveryTemplate({ site_address: CAPTURED_ADDRESS });

    // At least one template states it inline in the clause (Small Works); the
    // rest carry it on the reference line. Every one of them must name it
    // somewhere, or the address the contractor typed went nowhere.
    for (const body of bodies) {
      expect(body).toContain(CAPTURED_ADDRESS);
    }
  });

  it("leaves no dangling preposition when the address is blank", () => {
    for (const body of renderEveryTemplate({})) {
      // The exact production shape: "…carry out the following work at :".
      expect(body).not.toMatch(/\bat\s*:/);
      // And the general shape, in case a later edit moves the word: a colon
      // or a full stop with nothing but whitespace between it and "at".
      expect(body).not.toMatch(/\bat\s*[.,]/);
    }
  });

  it("still reads as a sentence when the address is blank", () => {
    const [smallWorks] = renderEveryTemplate({});

    expect(smallWorks).toContain("The Contractor agrees to carry out the following work:");
  });

  it("does not change a single character of a contract that has an address", () => {
    // The whole safety argument for touching a contract template: where the
    // address is present the rendered bytes are identical to before, so the
    // change can only ever affect the degenerate render. The committed PDF
    // golden pins this too — its fixture carries an address.
    const [smallWorks] = renderEveryTemplate({ site_address: CAPTURED_ADDRESS });

    expect(smallWorks).toContain(
      `The Contractor agrees to carry out the following work at ${CAPTURED_ADDRESS}:`,
    );
  });
});

describe("the statement of work does not invent an address it never had", () => {
  it("prints the address when there is one", () => {
    expect(siteAddressLine(CAPTURED_ADDRESS)).toBe(CAPTURED_ADDRESS);
  });

  it("says the address was not captured, rather than claiming it matches another", () => {
    // "Same as customer address" named a field that does not exist: render-sow
    // merges the single captured address INTO site_address, so there is no
    // second address for it to be the same as.
    for (const absent of [null, undefined, "", "   "]) {
      const line = siteAddressLine(absent);
      expect(line).not.toMatch(/same as/i);
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});
