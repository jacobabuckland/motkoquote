// D10, and the VAT row beside it.
//
// Clause 2 has exactly two buckets and `other` falls into labour — which is the
// right assignment, because everything the contractor charges for that is not
// materials IS their labour. The problem is that the editor's Kind field
// defaults to "Other", so a hand-typed quote lands 100% labour. Reported
// 14 Sep: three lines left as Other — a £500 reskim, £180 of bonding and
// multi-finish, £60 of waste removal — printed
//
//     | Labour    | £740.00 |
//     | Materials | £0.00   |
//
// on a job containing £180 of materials. The reviewer's judgement, which I
// share: that is MORE misleading than the single unlabelled row it replaced,
// because it names the wrong thing confidently. And on a job that genuinely has
// no materials, "Materials £0.00" is noise.
//
// So the split renders only where something was categorised as materials. Where
// a human made the distinction, the distinction is evidenced; where nobody did,
// clause 2 shows Subtotal and Total and asserts nothing about the composition.
//
// This is the retroactive half and it lands first: it fixes every contract
// rendered from here, including from quotes already in the database. Making
// Kind a required choice before send only helps rows written after it.
import { describe, expect, it } from "vitest";
import { buildContractVariables } from "@/lib/contracts/build-variables";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import { getContractTemplate } from "@/lib/contracts/templates";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Reskim hallway ceiling",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 500,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

/** The reported quote: three lines, all left on the default Kind of "Other". */
const ALL_OTHER = [
  line({ description: "Reskim hallway ceiling", unit_price: 500 }),
  line({ description: "Bonding and multi-finish", unit_price: 180 }),
  line({ description: "Waste removal", unit_price: 60 }),
];

const CATEGORISED = [
  line({ description: "Two days' labour", category: "labour", unit_price: 216 }),
  line({ description: "Plaster and beading", category: "materials", unit_price: 180 }),
];

/** Clause 2 as it actually renders, through the real section engine. */
const renderClauseTwo = (variables: ReturnType<typeof buildContractVariables>): string =>
  renderContractTemplate(getContractTemplate("standard_project").body, variables);

const vars = (lineItems: LineItem[], vatRegistered: boolean) =>
  buildContractVariables({
    contractor: {
      company_name: "Aspire Plastering Limited",
      company_number: "09117283",
      trade: "Plastering",
      vat_registered: vatRegistered,
      vat_number: vatRegistered ? "GB123456789" : null,
      business_profile: {},
      payout_account_holder_name: null,
      payout_sort_code: null,
      payout_account_number: null,
    } as Parameters<typeof buildContractVariables>[0]["contractor"],
    customer: { name: "Owen Pryce", contact: { email: "owen@example.com" } },
    lineItems,
    quoteReference: "CEC0C4F4",
    depositAmount: null,
    jobInput: {} as Parameters<typeof buildContractVariables>[0]["jobInput"],
    recordedQuote: null,
  });

/** Both templates that carry the split. Fixing one would leave the other. */
const SPLIT_TEMPLATES = ["standard_project", "large_staged_project"] as const;

describe("every template that carries the split", () => {
  it("suppresses it on all of them, not just the one the golden covers", () => {
    const v = vars(ALL_OTHER, false);
    for (const key of SPLIT_TEMPLATES) {
      const rendered = renderContractTemplate(getContractTemplate(key).body, v);
      expect(rendered, key).not.toContain("| Labour |");
      expect(rendered, key).not.toContain("| Materials |");
    }
  });

  it("keeps it on all of them where materials are stated", () => {
    const v = vars(CATEGORISED, false);
    for (const key of SPLIT_TEMPLATES) {
      const rendered = renderContractTemplate(getContractTemplate(key).body, v);
      expect(rendered, key).toContain("| Labour | £216.00 |");
      expect(rendered, key).toContain("| Materials | £180.00 |");
    }
  });
});

describe("a quote with nothing categorised as materials", () => {
  it("does NOT claim it is all labour", () => {
    const v = vars(ALL_OTHER, false);
    expect(v.show_labour).toBe("");
    expect(v.show_materials).toBe("");
  });

  it("prints neither row in the rendered clause", () => {
    const rendered = renderClauseTwo(vars(ALL_OTHER, false));
    expect(rendered).not.toContain("| Labour |");
    expect(rendered).not.toContain("| Materials |");
  });

  it("still prints the figures that ARE known", () => {
    const rendered = renderClauseTwo(vars(ALL_OTHER, false));
    expect(rendered).toContain("£740.00");
    expect(rendered).toContain("Subtotal");
    expect(rendered).toContain("Total");
  });
});

describe("a quote where somebody set the Kind", () => {
  it("keeps the split, because the distinction is evidenced", () => {
    const v = vars(CATEGORISED, false);
    expect(v.show_labour).toBe("yes");
    expect(v.show_materials).toBe("yes");
    expect(v.labour_cost).toBe("£216.00");
    expect(v.materials_cost).toBe("£180.00");

    const rendered = renderClauseTwo(v);
    expect(rendered).toContain("| Labour | £216.00 |");
    expect(rendered).toContain("| Materials | £180.00 |");
  });
});

describe("the VAT row follows the money here too", () => {
  it("is absent on an unregistered trade's contract", () => {
    // "VAT £0.00" states a taxable supply that did not happen, on the one
    // document the customer signs. Same defect as the row removed from the
    // quote page and the invoice.
    const rendered = renderClauseTwo(vars(CATEGORISED, false));
    expect(rendered).not.toMatch(/\|\s*VAT[^|]*\|\s*£0\.00\s*\|/);
  });

  it("is present, with the number, where VAT was actually charged", () => {
    const rendered = renderClauseTwo(vars(CATEGORISED, true));
    expect(rendered).toContain("GB123456789");
    expect(rendered).toContain("£79.20");
  });
});

// The gap that let template source onto a signed contract.
//
// `render-template.ts` is a single non-recursive pass, so a section nested
// inside another is never rendered — the outer match consumes it wholesale, and
// String.replace does not rescan what it substitutes. The VAT row was
//
//     {{#charged_vat}}| VAT{{#vat_registered}} (VAT no. …){{/vat_registered}} | … |{{/charged_vat}}
//
// so every contract by a registered trade that charged VAT printed the literal
// tags. Nothing caught it: the assertion above is `toContain("GB123456789")`,
// which stays true with the tags leaked, and the golden fixture never set
// `charged_vat`, so the gate re-baselined a table with no VAT row at all.
//
// A section tag surviving into output is never correct for ANY input, so it is
// pinned as a standing property over every branch rather than as one more case.
describe("a rendered contract never contains template source", () => {
  const BRANCHES = [
    { name: "all-other lines, unregistered", items: ALL_OTHER, registered: false },
    { name: "all-other lines, registered", items: ALL_OTHER, registered: true },
    { name: "categorised lines, unregistered", items: CATEGORISED, registered: false },
    { name: "categorised lines, registered", items: CATEGORISED, registered: true },
  ];

  for (const branch of BRANCHES) {
    for (const key of SPLIT_TEMPLATES) {
      it(`leaves no section tag — ${branch.name}, ${key}`, () => {
        const rendered = renderContractTemplate(
          getContractTemplate(key).body,
          vars(branch.items, branch.registered),
        );
        const leaked = rendered.match(/{{[^}]*}}/g) ?? [];
        expect(leaked, `leaked into ${key}`).toEqual([]);
      });
    }
  }

  it("labels the VAT row with the number, as a plain value", () => {
    // The claim the old assertion was reaching for. `toContain` on the number
    // alone passed while the row read
    // "VAT{{#vat_registered}} (VAT no. GB123456789){{/vat_registered}}".
    const rendered = renderClauseTwo(vars(CATEGORISED, true));
    expect(rendered).toContain("| VAT (VAT no. GB123456789) | £79.20 |");
  });

  it("labels it plainly where a registered trade has no number recorded", () => {
    // "(VAT no. )" with nothing after it is worse than no parenthetical.
    const v = { ...vars(CATEGORISED, true), vat_row_label: "VAT" };
    expect(renderClauseTwo(v)).toContain("| VAT | £79.20 |");
  });
});

// Reported 15 Sep: clause 2 called travel, a call-out and a provisional sum
// "Labour", and contradicted the quote PDF for the same job.
//
// `labourCost` is `subtotal - materialsCost`, so every category that is not
// materials lands on the Labour row. A hand-priced job with one line of each
// kind produced, in the same customer's inbox:
//
//     quote PDF:  LABOUR £1,000 · MATERIALS £200 · TRAVEL £50
//                 CALLOUT £100 · OTHER (provisional) £150
//     contract:   Labour £1,300.00 · Materials £200.00
//
// £300 apart on the number a day-rate dispute turns on, and the signed document
// is the one that governs. #757 stopped the table asserting a split when it knew
// nothing; this stops it mis-asserting when it knows something.
describe("clause 2 shows one row per kind of charge", () => {
  const ONE_OF_EACH = [
    line({ description: "Plastering labour", category: "labour", unit_price: 1000 }),
    line({ description: "Plaster and beading", category: "materials", unit_price: 200 }),
    line({ description: "Travel", category: "travel", unit_price: 50 }),
    line({ description: "Emergency call-out", category: "callout", unit_price: 100 }),
    line({
      description: "Provisional sum — making good",
      category: "other",
      unit_price: 150,
      provisional: true,
    }),
  ];

  it("reports each category at its own figure", () => {
    const v = vars(ONE_OF_EACH, true);
    for (const key of SPLIT_TEMPLATES) {
      const rendered = renderContractTemplate(getContractTemplate(key).body, v);
      expect(rendered, key).toContain("| Labour | £1,000.00 |");
      expect(rendered, key).toContain("| Materials | £200.00 |");
      expect(rendered, key).toContain("| Travel | £50.00 |");
      expect(rendered, key).toContain("| Call-out | £100.00 |");
      expect(rendered, key).toContain("| Provisional sums | £150.00 |");
    }
  });

  it("never reports a non-labour line as labour", () => {
    // The reported falsehood: £1,300.00 on a job with £1,000 of labour.
    const v = vars(ONE_OF_EACH, true);
    for (const key of SPLIT_TEMPLATES) {
      expect(renderContractTemplate(getContractTemplate(key).body, v), key).not.toContain(
        "£1,300.00",
      );
    }
  });

  it("agrees with the quote PDF, which groups by the same categories", () => {
    const v = vars(ONE_OF_EACH, true);
    const rendered = renderClauseTwo(v);
    expect(rendered).toContain("| Subtotal | £1,500.00 |");
    expect(rendered).toContain("| VAT (VAT no. GB123456789) | £300.00 |");
  });

  it("makes the rows sum to the subtotal", () => {
    // Every charged line lands in exactly one bucket, so the breakdown foots.
    const v = vars(ONE_OF_EACH, true);
    const rows = [
      v.labour_cost,
      v.materials_cost,
      v.travel_cost,
      v.callout_cost,
      v.other_cost,
      v.provisional_cost,
    ].map((amount) => Number(amount.replace(/[£,]/g, "")));
    const summed = Math.round(rows.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(summed).toBe(Number(v.subtotal.replace(/[£,]/g, "")));
  });

  it("gives a provisional sum its own row rather than folding it into its category", () => {
    // An allowance for undefined work is not settled work. The fixture's
    // provisional carries category "other", and Other works must not absorb it.
    const v = vars(ONE_OF_EACH, true);
    expect(v.provisional_cost).toBe("£150.00");
    expect(v.show_other).toBe("");
  });

  it("shows nothing about composition when every line is one kind", () => {
    // #757's rule, kept: the row would only restate the subtotal, and this is
    // the shape of a hand-built quote where Kind was never touched.
    const allOther = [
      line({ description: "Reskim hallway ceiling", unit_price: 500 }),
      line({ description: "Bonding and multi-finish", unit_price: 180 }),
      line({ description: "Waste removal", unit_price: 60 }),
    ];
    const v = vars(allOther, true);
    const rendered = renderClauseTwo(v);
    expect(rendered).not.toContain("| Labour |");
    expect(rendered).not.toContain("| Other works |");
    expect(rendered).toContain("| Subtotal | £740.00 |");
  });

  it("keeps the two-row case reading exactly as it did", () => {
    const v = vars(CATEGORISED, true);
    const rendered = renderClauseTwo(v);
    expect(rendered).toContain("| Labour | £216.00 |");
    expect(rendered).toContain("| Materials | £180.00 |");
    expect(rendered).not.toContain("| Travel |");
  });
});
