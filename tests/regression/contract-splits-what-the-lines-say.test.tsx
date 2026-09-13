/**
 * @vitest-environment happy-dom
 */

// Contract clause 2 put the whole price in one row, and #720 only flipped WHICH
// row.
//
// Before 13 Sep the split summed `category === "labour"` and gave Materials the
// remainder, so a fixed-price job printed `Labour £0.00 / Materials £450.00`.
// #720 inverted it — Materials is now the derived-from side — which fixed the
// fixed-price case and moved the identical defect onto every hand-typed quote:
//
//   labour £1,000 + materials £200  ->  Labour £1,200.00, Materials £0.00
//   labour £1,000 + materials £414  ->  Labour £1,414.00, Materials £0.00
//
// Both reported 13 Sep, both on contracts created AFTER the fix, so neither is
// the backfill gap. Setting "Materials supplied by: Contractor" made no
// difference, because that field says who buys them, not what the lines are.
//
// The cause is not the derivation. `+ Add line item` created every line as
// `category: "other"` and the editor offered no control to change it, so a
// typed quote reached the contract carrying no categories at all — and the
// quote PDF grouped both lines under a header reading OTHER, which is the same
// fact showing through a different surface.
//
// No split can be derived from data that is absent, whichever way round the
// subtraction goes. So the editor asks, and this pins both halves: the control
// exists, and the split follows what it records.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { buildContractVariables } from "@/lib/contracts/build-variables";
import { QuoteEditor } from "@/app/jobs/[id]/quote-editor";
import type { LineItem } from "@/lib/schemas/job";
import type { BusinessProfile, ContractJobInput } from "@/lib/schemas/contract";

afterEach(cleanup);

vi.mock("@/app/jobs/actions", () => ({
  setQuotePricingMode: vi.fn(async (_input?: unknown) => ({ lineItems: [], total: 0 })),
  updateQuoteLineItems: vi.fn(async (_input?: unknown) => ({ total: 0 })),
  sendQuote: vi.fn(async (_input?: unknown) => ({ ok: true })),
  redraftJob: vi.fn(async (_input?: unknown) => ({ lineItemCount: 0 })),
  reportVoicePipelineFailure: vi.fn(async (_input?: unknown) => {}),
}));

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Work",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 100,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

const PROFILE: BusinessProfile = {} as BusinessProfile;

const JOB_INPUT: ContractJobInput = {
  scope_of_work: "Reskim three rooms",
} as ContractJobInput;

const variablesFor = (lineItems: LineItem[]) =>
  buildContractVariables({
    contractor: {
      company_name: "Buckland Plastering Ltd",
      company_number: null,
      trade: "Plastering",
      vat_registered: false,
      vat_number: null,
      business_profile: PROFILE,
      payout_account_holder_name: null,
      payout_sort_code: null,
      payout_account_number: null,
      payout_details_complete: false,
      stripe_account_id: null,
      stripe_payouts_enabled: false,
      stripe_pay_by_bank_enabled: false,
    },
    customer: { name: "A Customer", contact: {} },
    lineItems,
    quoteReference: "C25D2A40",
    depositAmount: null,
    jobInput: JOB_INPUT,
  });

describe("the two reported contracts, with the lines categorised", () => {
  it("c25d2a40 — labour £1,000 and materials £200 split as they were entered", () => {
    const vars = variablesFor([
      line({ description: "Labour", category: "labour", quantity: 4, unit: "day", unit_price: 250 }),
      line({ description: "Bonding and multi-finish", category: "materials", unit_price: 200 }),
    ]);

    expect(vars.labour_cost).toBe("£1,000.00");
    expect(vars.materials_cost).toBe("£200.00");
  });

  it("e5d8a3be — labour £1,000 and materials £414 likewise", () => {
    const vars = variablesFor([
      line({ description: "Labour", category: "labour", quantity: 4, unit: "day", unit_price: 250 }),
      line({ description: "Plasterboard", category: "materials", quantity: 18, unit: "sheet", unit_price: 23 }),
    ]);

    expect(vars.labour_cost).toBe("£1,000.00");
    expect(vars.materials_cost).toBe("£414.00");
  });

  it("still adds up to the subtotal, whatever the split", () => {
    const vars = variablesFor([
      line({ description: "Labour", category: "labour", quantity: 4, unit: "day", unit_price: 250 }),
      line({ description: "Plasterboard", category: "materials", quantity: 18, unit: "sheet", unit_price: 23 }),
    ]);

    expect(vars.subtotal).toBe("£1,414.00");
  });
});

describe("what #720 fixed stays fixed", () => {
  it("a fixed-price collapse is labour, not materials", () => {
    // The single works line a fixed-price quote collapses to is `other`, and
    // putting it in Materials is what printed `Labour £0.00` on a £450
    // all-labour job.
    const vars = variablesFor([
      line({ description: "Plastering works", category: "other", unit_price: 450 }),
    ]);

    expect(vars.labour_cost).toBe("£450.00");
    expect(vars.materials_cost).toBe("£0.00");
  });

  it("travel and call-out stay on the labour side", () => {
    const vars = variablesFor([
      line({ description: "Labour", category: "labour", unit_price: 500 }),
      line({ description: "Travel", category: "travel", unit_price: 40 }),
      line({ description: "Call-out", category: "callout", unit_price: 60 }),
      line({ description: "Plaster", category: "materials", unit_price: 125 }),
    ]);

    expect(vars.labour_cost).toBe("£600.00");
    expect(vars.materials_cost).toBe("£125.00");
  });
});

describe("the editor asks what kind of line it is", () => {
  const renderEditor = (lineItems: LineItem[]) =>
    render(
      <QuoteEditor
        jobId="job_1"
        quoteId="quote_1"
        jobTitle="Reskim, Norwich"
        initialLineItems={lineItems}
        vatRegistered={false}
        initialPricingMode="calculated"
        initialFixedAmount={null}
        quoteStatus="draft"
      />,
    );

  it("offers a kind for each line", () => {
    renderEditor([line({ description: "Bonding and multi-finish" })]);

    // The row is collapsed until opened — the control lives in the detail.
    fireEvent.click(screen.getByRole("button", { name: /Bonding and multi-finish/i }));

    expect(screen.getByRole("combobox", { name: /Line item 1 kind/i })).toBeDefined();
  });

  it("offers Materials as a choice, which is the one that was unreachable", () => {
    renderEditor([line({ description: "Bonding and multi-finish" })]);
    fireEvent.click(screen.getByRole("button", { name: /Bonding and multi-finish/i }));

    const kind = screen.getByRole("combobox", { name: /Line item 1 kind/i }) as HTMLSelectElement;
    const options = Array.from(kind.options).map((o) => o.value);

    expect(options).toContain("materials");
    expect(options).toContain("labour");
  });

  it("shows the line's current kind rather than defaulting the display", () => {
    renderEditor([line({ description: "Four days plastering", category: "labour" })]);
    fireEvent.click(screen.getByRole("button", { name: /Four days plastering/i }));

    const kind = screen.getByRole("combobox", { name: /Line item 1 kind/i }) as HTMLSelectElement;
    expect(kind.value).toBe("labour");
  });
});
