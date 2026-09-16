// PASS-12 CRITICAL 1: the Small Works contract hid the deposit, then billed it.
//
// Reported 16 Sep. Contract 49b6d63d's header read "Total quote value £1,860.00
// / Deposit £315.00 / Balance on completion £1,545.00". Clause 2 — the
// OPERATIVE Price and Payment clause — said only that the total price was
// £1,860.00 and that payment was due on completion. The £315.00 appeared
// nowhere in the body. The customer signed a document whose payment clause said
// nothing was due until the job was finished, and was invoiced £315.00 sixty
// seconds later.
//
// The pass-9 fix reached exactly ONE of the five templates. Measured at the
// time of writing this test:
//
//   small_works               clause 2  — no deposit block at all
//   maintenance_recurring     clause 3  — no deposit block at all
//   large_staged_project      clause 3  — deposit shown, balance UNCONDITIONAL
//   regulated_certified_works clause 5  — deposit shown, balance UNCONDITIONAL
//   standard_project          clause 3  — correct
//
// So two templates hid the deposit and two more told a customer who had paid
// the whole price in advance that a balance still fell due.
//
// This is the matrix test the reviewer asked for: every template, every deposit
// shape, asserting the BODY agrees with the header figures. It is a regression
// test rather than a snapshot on purpose — it pins the claims, not the prose,
// so the wording can still be improved.
import { describe, expect, it } from "vitest";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import type { ContractVariables } from "@/lib/schemas/contract";

/**
 * The three shapes a deposit comes in, expressed exactly as build-variables.ts
 * computes them. `has_balance` and `deposit_is_whole_price` are mutually
 * exclusive there, and `no_deposit` is set only when no deposit was agreed.
 */
const NO_DEPOSIT: Partial<ContractVariables> = {
  deposit_amount: "",
  has_balance: "yes",
  deposit_is_whole_price: "",
  no_deposit: "yes",
};

const PARTIAL_DEPOSIT: Partial<ContractVariables> = {
  deposit_amount: "£315.00",
  has_balance: "yes",
  deposit_is_whole_price: "",
  no_deposit: "",
};

const WHOLE_PRICE_DEPOSIT: Partial<ContractVariables> = {
  deposit_amount: "£1,860.00",
  has_balance: "",
  deposit_is_whole_price: "yes",
  no_deposit: "",
};

const render = (body: string, deposit: Partial<ContractVariables>): string =>
  renderContractTemplate(body, {
    total_price: "£1,860.00",
    vat_registered: "",
    vat_amount: "",
    vat_number: "",
    scope_of_work: "Plastering throughout",
    exclusions: "",
    default_payment_terms: "",
    payment_methods: "",
    bank_details: "",
    payment_schedule: "",
    start_date: "1 October 2026",
    estimated_duration: "Three days",
    special_terms: "",
    ...deposit,
  } as ContractVariables);

describe("every contract template, against every deposit shape", () => {
  // An unrendered tag in a signed document is the worst outcome here, and it is
  // the one a nesting or inverted-section mistake produces. Checked first,
  // because it makes every other assertion below meaningless if it fires.
  it("leaves no template tag unrendered", () => {
    for (const template of CONTRACT_TEMPLATES) {
      for (const [shape, deposit] of [
        ["no deposit", NO_DEPOSIT],
        ["partial", PARTIAL_DEPOSIT],
        ["whole price", WHOLE_PRICE_DEPOSIT],
      ] as const) {
        const rendered = render(template.body, deposit);
        expect(rendered, `${template.key} / ${shape}`).not.toMatch(/\{\{/);
        expect(rendered, `${template.key} / ${shape}`).not.toMatch(/\}\}/);
      }
    }
  });

  it("states the deposit in the body whenever one was agreed", () => {
    // The reported defect, stated once for all five. A header figure the body
    // never mentions is how a customer comes to sign a payment clause that
    // contradicts what they are about to be billed.
    for (const template of CONTRACT_TEMPLATES) {
      expect(render(template.body, PARTIAL_DEPOSIT), template.key).toContain("£315.00");
      expect(render(template.body, WHOLE_PRICE_DEPOSIT), template.key).toContain("£1,860.00");
    }
  });

  it("never promises a balance when the deposit IS the whole price", () => {
    // The other half, and the more expensive one: someone who has paid in full
    // up front reads that they still owe money on completion.
    for (const template of CONTRACT_TEMPLATES) {
      const rendered = render(template.body, WHOLE_PRICE_DEPOSIT).toLowerCase();

      expect(rendered, template.key).not.toContain("the remainder is due on completion");
      expect(rendered, template.key).not.toContain("the balance is due on completion");
      expect(rendered, template.key).not.toContain(
        "the balance is payable against completed milestones",
      );
    }
  });

  it("still states a balance when one is genuinely owed", () => {
    // The guard that must not move. Silencing the balance everywhere would pass
    // the assertion above and be a far worse document.
    for (const template of CONTRACT_TEMPLATES) {
      const rendered = render(template.body, PARTIAL_DEPOSIT).toLowerCase();
      expect(rendered, template.key).toMatch(/balance|remainder|due on completion|stage/);
    }
  });

  it("says payment is due on completion when there is no deposit at all", () => {
    // Small Works' original sentence. It was unconditional and therefore wrong
    // once a deposit existed; it is still right when one does not, and losing
    // it would leave that contract silent about when payment falls due.
    const smallWorks = CONTRACT_TEMPLATES.find((t) => t.key === "small_works");
    expect(smallWorks).toBeDefined();

    const rendered = render(smallWorks!.body, NO_DEPOSIT);
    expect(rendered).toContain("Payment is due **on completion**");

    // And it must NOT appear alongside a deposit projection, which is the
    // contradiction the item exists to remove.
    expect(render(smallWorks!.body, PARTIAL_DEPOSIT)).not.toContain(
      "Payment is due **on completion**",
    );
  });
});
