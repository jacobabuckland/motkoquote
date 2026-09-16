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
// THE FIX WAS PLUMBING, NOT NEW COPY. CLAUDE.md forbids editing clause wording
// here; customer-facing contractual copy is on the AGENTS.md escalation list.
// So not one word was added or rewritten: the three-word cross-reference "as
// set out below" and the blockquote that was meant to carry the schedule were
// made conditional on there being one.
//
// ---------------------------------------------------------------------------
// SUPERSEDED, 16 Sep, on Jacob's decision (areas/motko.md).
//
// The sentence PASS-7 left standing — "the balance is payable against completed
// milestones. Each stage becomes due when that stage is complete and the
// Contractor has issued an invoice." — was the template's own words, and it was
// NOT true. Motko cannot issue that invoice. There are two invoice types,
// deposit and final; a second deposit is refused, and a final requires the job
// marked complete and then bills the WHOLE remaining balance. Measured on a
// £24,000 four-stage schedule: stage 1 raises £6,000, stage 2 is refused both
// ways, and stage 3 raises £18,000 — the entire rest of the job. So a
// contractor wanting the middle stage had to mark the work finished
// untruthfully and send the customer one demand for everything left.
//
// Nothing implemented retention either; the word appeared only in clause 4.
// And `payment_stages` is not a milestone system despite the name — it is a
// Pay-by-Bank rail splitter, fixed 50/50, only above £10k. All four signed
// staged contracts on production have zero stage rows.
//
// Clause 3 now states the deposit and the balance on completion, in
// STANDARD_PROJECT's own sanctioned wording; clause 4 is gone. Three assertions
// below are retired with the promise they pinned, and replaced by the converse
// claim. The maintenance case and the all-templates sweep are untouched — the
// dangling-cross-reference defect they guard is unrelated and still live.
// ---------------------------------------------------------------------------
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

  it("no longer promises an invoice per milestone", () => {
    // Retires the PASS-7 assertion that these two sentences survive. They were
    // the template's own words and they were false — see the header.
    const rendered = renderContractTemplate(templateBody("large_staged_project"), vars());

    expect(rendered).not.toMatch(/payable against completed milestones/i);
    expect(rendered).not.toMatch(/each stage becomes due/i);
    expect(rendered, "retention had no mechanism anywhere in the tree").not.toMatch(
      /retention/i,
    );
  });

  it("states the deposit and the balance, which is what Motko can invoice", () => {
    // Gated, not gutted, still applies — the clause has to carry a meaning.
    // The meaning is now the one the invoicing code actually implements.
    const rendered = renderContractTemplate(
      templateBody("large_staged_project"),
      vars({ deposit_amount: "£750.00", has_balance: "yes" }),
    );

    expect(rendered).toMatch(/\*\*Deposit:\*\* £750\.00/);
    expect(rendered).toMatch(/the remainder is due on completion/i);
  });

  it("numbers its clauses without a gap where retention was", () => {
    const rendered = renderContractTemplate(templateBody("large_staged_project"), vars());
    const numbers = [...rendered.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));

    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });
});

describe("a staged contract no longer takes a schedule at all", () => {
  // Retires both assertions of the old "WITH a schedule is unchanged" block.
  // The contract form stopped asking for one, because clause 3 stopped printing
  // it and nothing downstream could honour it.
  const schedule = "30% on start, 40% at first fix, 30% on completion.";

  it("ignores one even if a stored contract still carries it", () => {
    // job_input_json on the four signed contracts still holds whatever was
    // typed. Re-rendering one must not resurrect the promise.
    const rendered = renderContractTemplate(
      templateBody("large_staged_project"),
      vars({ payment_schedule: schedule }),
    );

    expect(rendered).not.toContain(schedule);
    expect(rendered).not.toMatch(/as set out below/i);
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
