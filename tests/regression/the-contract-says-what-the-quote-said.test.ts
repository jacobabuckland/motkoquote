// The fourth VAT surface, and the only one a customer signs.
//
// The 14 Sep review found the quote PDF, /q/[id] and the job page all fixed —
// and the bug moved onto the contract. A quote written while unregistered
// (recorded VAT £0.00, £740.00 on /q/[id] and on the PDF) produced, once
// registration was switched back on:
//
//   Header:   Total quote value £740.00 · Deposit (30%) £222.00 · Balance £518.00
//   Clause 2: Subtotal £740.00 · VAT (VAT no. GB…) £148.00 · Total £888.00
//
// One page, two prices, £148 apart, and the payment schedule (222 + 518 = 740)
// no longer summing to the price clause. The customer is asked to sign it.
//
// buildContractVariables was computing from `contractor.vat_registered` —
// exactly what render-quote.ts and the job page were doing before #748. This is
// the same fix, on the fourth surface.
//
// The contract stays FROZEN at generation: a stored contract keeps what it was
// rendered with, which was already right and is unchanged. What changes is that
// the figure rendered is the recorded one.
import { describe, expect, it } from "vitest";
import { buildContractVariables } from "@/lib/contracts/build-variables";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Reskim hallway ceiling",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 740,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

const contractor = (vatRegistered: boolean) => ({
  company_name: "Aspire Plastering Limited",
  company_number: "09117283",
  trade: "Plastering",
  vat_registered: vatRegistered,
  vat_number: vatRegistered ? "GB123456789" : null,
  business_profile: {},
  payout_account_holder_name: null,
  payout_sort_code: null,
  payout_account_number: null,
});

const build = (
  vatRegistered: boolean,
  recordedQuote: { total: number; subtotal: number | null; vat_amount: number | null } | null,
  lineItems: LineItem[] = [line({})],
) =>
  buildContractVariables({
    contractor: contractor(vatRegistered) as Parameters<
      typeof buildContractVariables
    >[0]["contractor"],
    customer: { name: "Rhys Calder", contact: { email: "rhys@example.com" } },
    lineItems,
    quoteReference: "CEC0C4F4",
    depositAmount: 222,
    jobInput: {} as Parameters<typeof buildContractVariables>[0]["jobInput"],
    recordedQuote,
  });

/** Rhys's job: written unregistered, so £740 with no VAT ever charged. */
const RHYS = { total: 740, subtotal: 740, vat_amount: 0 };

/** Nadia's job: written registered. £2,666.90 net, £533.38 VAT, £3,200.28. */
const NADIA = { total: 3200.28, subtotal: 2666.9, vat_amount: 533.38 };
const NADIA_LINES = [line({ unit_price: 2666.9 })];

describe("a quote that charged no VAT gets a contract that charges none", () => {
  it("does not invent £148 when registration is switched on afterwards", () => {
    // The reported document, exactly.
    const vars = build(true, RHYS);
    expect(vars.total_price).toBe("£740.00");
    expect(vars.vat_amount).toBe("£0.00");
  });

  it("says the same thing with registration off", () => {
    expect(build(false, RHYS).total_price).toBe(build(true, RHYS).total_price);
    expect(build(false, RHYS).vat_amount).toBe(build(true, RHYS).vat_amount);
  });

  it("agrees with the deposit the same contract states", () => {
    // The deposit is 30% of the recorded £740. The defect broke the page's
    // internal arithmetic: 222 + 518 = 740 in the header while the price
    // clause said 888.
    const vars = build(true, RHYS);
    expect(vars.total_price).toBe("£740.00");
    expect(vars.deposit_amount).toBe("£222.00");
  });
});

describe("a quote that DID charge VAT keeps it", () => {
  it("prints the recorded split while registered", () => {
    const vars = build(true, NADIA, NADIA_LINES);
    expect(vars.subtotal).toBe("£2,666.90");
    expect(vars.vat_amount).toBe("£533.38");
    expect(vars.total_price).toBe("£3,200.28");
  });

  it("does NOT drop the VAT if registration is switched off", () => {
    // The mirror of the first case, and the one that matters for a contract
    // already out for signature: what the customer agreed to does not shrink
    // because a setting moved.
    const vars = build(false, NADIA, NADIA_LINES);
    expect(vars.vat_amount).toBe("£533.38");
    expect(vars.total_price).toBe("£3,200.28");
  });
});

describe("a quote written before the columns existed", () => {
  it("HOLDS STILL, rather than computing from the live registration", () => {
    // Changed 14 Sep, and this assertion used to say the opposite. The pass-5
    // review found the legacy fallback was the last place a quote still moved
    // on a checkbox: a £450 quote read £540 on /q/[id] and the PDF while the
    // invoice billed £450. A contract is the document a customer signs, so it
    // is the worst place for that.
    //
    // The stored total is what was charged; the split is unknown and none is
    // asserted. See quoteTotalsForDisplay.
    const legacy = { total: 740, subtotal: null, vat_amount: null };
    expect(build(false, legacy).vat_amount).toBe("£0.00");
    expect(build(true, legacy).vat_amount).toBe("£0.00");
    expect(build(true, legacy).total_price).toBe("£740.00");
    expect(build(false, legacy).total_price).toBe("£740.00");
  });

  it("computes when no quote row is supplied at all", () => {
    expect(build(false, null).total_price).toBe("£740.00");
  });
});
