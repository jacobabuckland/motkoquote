// PASS-7 CRITICAL 2: the signed contract promised a payment schedule that was
// not there.
//
// Clause 3 of large_staged_project read, verbatim:
//
//     - Stage payments: the balance is payable against completed milestones
//       AS SET OUT BELOW. Each stage becomes due when that stage is complete
//       and the Contractor has issued an invoice.
//
//     >
//
//     Each stage invoice is payable within the terms in 7 days
//
// Nothing was set out below. The "Payment schedule (stages)" box on the
// contract form is optional and blank is its default, so this is what a
// customer signs on an ordinary staged job: an agreement to milestones that do
// not exist. In a dispute the clause is unusable by either side.
//
// maintenance_recurring had the identical shape in clause 2 — "The services
// will be provided on the following basis:" above an empty blockquote — and is
// fixed with it.
//
// THE FIX IS PLUMBING, NOT NEW COPY. CLAUDE.md forbids editing clause wording
// here; customer-facing contractual copy is on the AGENTS.md escalation list.
// So not one word is added or rewritten: the three-word cross-reference "as
// set out below" and the blockquote that was meant to carry the schedule are
// made conditional on there being one. The sentence that remains when there is
// no schedule — "the balance is payable against completed milestones. Each
// stage becomes due when that stage is complete and the Contractor has issued
// an invoice." — is the template's own existing words, and is true.
import { describe, expect, it } from "vitest";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import type { ContractVariables } from "@/lib/schemas/contract";

const templateBody = (key: string): string => {
  const template = CONTRACT_TEMPLATES.find((t) => t.key === key);
  if (!template) throw new Error(`no template ${key}`);
  return template.body;
};

// Only the variables these assertions turn on. Everything else renders empty,
// which is exactly the state the defect lived in.
const vars = (overrides: Partial<Record<string, string>> = {}): ContractVariables =>
  ({
    business_name: "Fenland Electrical Ltd",
    client_name: "Mr A Barrett",
    quote_reference: "A1B2C3D4",
    contract_date: "19 Aug 2026",
    scope_of_work: "Full rewire of a three-bed semi.",
    total_price: "£2,784.00",
    default_payment_terms: "7 days",
    ...overrides,
  }) as unknown as ContractVariables;

describe("a staged contract with no schedule promises none", () => {
  it("drops the cross-reference when the schedule is blank", () => {
    const rendered = renderContractTemplate(templateBody("large_staged_project"), vars());

    expect(rendered).not.toMatch(/as set out below/i);
  });

  it("leaves no empty blockquote where the schedule would have been", () => {
    // The observable artefact: a "> " on its own line, pointing at nothing.
    const rendered = renderContractTemplate(templateBody("large_staged_project"), vars());

    expect(rendered).not.toMatch(/^>\s*$/m);
  });

  it("still states when a stage becomes due, in the template's own words", () => {
    // The clause is gated, not gutted. What remains has to carry the meaning,
    // or the fix has traded a false promise for a silent one.
    const rendered = renderContractTemplate(templateBody("large_staged_project"), vars());

    expect(rendered).toMatch(/payable against completed milestones/i);
    expect(rendered).toMatch(
      /Each stage becomes due when that stage is complete and the Contractor has issued an invoice/i,
    );
  });
});

describe("a staged contract WITH a schedule is unchanged", () => {
  const schedule = "30% on start, 40% at first fix, 30% on completion.";

  it("keeps the cross-reference and prints the schedule under it", () => {
    const rendered = renderContractTemplate(
      templateBody("large_staged_project"),
      vars({ payment_schedule: schedule }),
    );

    expect(rendered).toMatch(/as set out below/i);
    expect(rendered).toContain(schedule);
  });

  it("puts the schedule AFTER the sentence that points at it", () => {
    // "as set out below" is a direction. If the schedule rendered above it the
    // clause would be wrong in the other direction.
    const rendered = renderContractTemplate(
      templateBody("large_staged_project"),
      vars({ payment_schedule: schedule }),
    );

    expect(rendered.indexOf("as set out below")).toBeLessThan(rendered.indexOf(schedule));
  });
});

describe("the same shape in the maintenance agreement", () => {
  it("drops the lead-in when there is no basis to state", () => {
    const rendered = renderContractTemplate(templateBody("maintenance_recurring"), vars());

    expect(rendered).not.toMatch(/provided on the following basis/i);
    expect(rendered).not.toMatch(/^>\s*$/m);
  });

  it("keeps it when there is", () => {
    const basis = "Quarterly visits, first week of each quarter.";
    const rendered = renderContractTemplate(
      templateBody("maintenance_recurring"),
      vars({ payment_schedule: basis }),
    );

    expect(rendered).toMatch(/provided on the following basis/i);
    expect(rendered).toContain(basis);
  });
});

describe("no template points at a schedule it does not print", () => {
  // The general claim, across every template rather than the two known ones —
  // a third carrying the same shape would otherwise ship unnoticed.
  it.each(CONTRACT_TEMPLATES.map((t) => t.key))(
    "%s: renders no dangling cross-reference with the schedule blank",
    (key) => {
      const rendered = renderContractTemplate(templateBody(key), vars());

      expect(rendered, `${key} points below at a schedule it does not print`).not.toMatch(
        /as set out below/i,
      );
      expect(rendered, `${key} renders an empty blockquote`).not.toMatch(/^>\s*$/m);
    },
  );
});
