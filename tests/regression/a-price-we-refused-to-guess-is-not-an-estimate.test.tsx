/**
 * @vitest-environment happy-dom
 *
 * A plastering quote on motko.app, 22 Sep:
 *
 *     Finishing plaster (multi-finish) – bedroom and bathroom re-skim   £0.00
 *     [Est.]
 *     3 bag @ £0.00
 *
 *     Items marked Est. are estimates — check each one before sending.
 *
 * Reported as "the plaster cost is estimated 0 which is weird", and it is.
 * £0.00 there is not an estimate — it is the app REFUSING to invent a material
 * price because nothing the contractor confirmed says what it costs, which is
 * the PFIX-4 rule doing its job. Calling the refusal an estimate claims we
 * guessed, and a £0.00 "estimate" beside a line item reads as "included"
 * rather than "we have no price for this".
 *
 * The same complaint arrived in the 21 Sep review's lower-priority batch: "A
 * £0.00 'estimate' for delivery reads to a plasterer as 'delivery included',
 * not 'we lost your price'."
 *
 * "Not priced" is not a new idiom — it is already the app's own word for this
 * state, in UNCONFIRMED_ESTIMATE_PREFIX and UNSOURCED_PRICE_FLAG.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QuoteEditor } from "@/app/jobs/[id]/quote-editor";
import type { LineItem } from "@/lib/schemas/job";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/jobs/actions", () => ({
  updateQuoteLineItems: vi.fn(async (_input?: unknown) => undefined),
  sendQuote: vi.fn(async (_input?: unknown) => undefined),
  redraftJob: vi.fn(async (_input?: unknown) => undefined),
  reportEmptyQuoteDraft: vi.fn(async (_input?: unknown) => undefined),
  setQuotePricingMode: vi.fn(async (_input?: unknown) => undefined),
}));

afterEach(cleanup);

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Finishing plaster (multi-finish)",
  category: "materials",
  quantity: 3,
  unit: "bag",
  unit_price: 0,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: true,
  ...over,
});

const unpriced = line({});
const estimated = line({ description: "10-way RCBO consumer unit", unit_price: 180, quantity: 1, unit: "unit" });
const priced = line({ description: "Plastering labour", category: "labour", unit_price: 220, quantity: 1, unit: "day", assumed: false });

const renderEditor = (items: LineItem[]) =>
  render(
    <QuoteEditor
      jobId="job-1"
      quoteId="quote-1"
      jobTitle="Re-skim"
      initialLineItems={items}
      contractorFlags={[]}
      vatRegistered={false}
    />,
  );

const rowFor = (pattern: RegExp) =>
  screen.getByText(pattern).closest("button") as HTMLElement;

describe("a line the app refused to price", () => {
  it("is not called an estimate", () => {
    renderEditor([unpriced]);

    expect(rowFor(/Finishing plaster/).textContent).toContain("Not priced");
    expect(rowFor(/Finishing plaster/).textContent).not.toContain("Est.");
  });

  it("says what it means for the quote, not 'check each one'", () => {
    // "Check each one before sending" is advice about a figure. There is no
    // figure. What the contractor cannot see is that the line is charging
    // nothing, so that is what it says.
    renderEditor([unpriced]);

    expect(screen.getByText(/have no price yet/)).toBeTruthy();
    expect(screen.queryByText(/Items marked Est\. are estimates/)).toBeNull();
  });
});

describe("a line we really did estimate", () => {
  it("keeps the Est. chip and its own footnote", () => {
    renderEditor([estimated]);

    expect(rowFor(/10-way RCBO/).textContent).toContain("Est.");
    expect(rowFor(/10-way RCBO/).textContent).not.toContain("Not priced");
    expect(screen.getByText(/Items marked Est\. are estimates/)).toBeTruthy();
    expect(screen.queryByText(/have no price yet/)).toBeNull();
  });
});

describe("both on one quote, which is the real shape", () => {
  it("marks each line for what it is", () => {
    renderEditor([priced, estimated, unpriced]);

    expect(rowFor(/10-way RCBO/).textContent).toContain("Est.");
    expect(rowFor(/Finishing plaster/).textContent).toContain("Not priced");
    expect(rowFor(/Plastering labour/).textContent).not.toContain("Est.");
    expect(rowFor(/Plastering labour/).textContent).not.toContain("Not priced");
  });

  it("gives each footnote once, and only when it applies", () => {
    renderEditor([priced, estimated, unpriced]);

    expect(screen.getAllByText(/Items marked Est\. are estimates/)).toHaveLength(1);
    expect(screen.getAllByText(/have no price yet/)).toHaveLength(1);
  });

  it("says nothing about either when every line carries a price", () => {
    renderEditor([priced]);

    expect(screen.queryByText(/Items marked Est\./)).toBeNull();
    expect(screen.queryByText(/have no price yet/)).toBeNull();
  });
});

describe("a quantity that multiplies to zero", () => {
  it("reads the LINE TOTAL, not the unit rate", () => {
    // 8 bags at £0.00 is still nothing charged. Keying off unit_price alone
    // would be the same bug with an extra step.
    renderEditor([line({ quantity: 8, unit_price: 0 })]);

    expect(rowFor(/Finishing plaster/).textContent).toContain("Not priced");
  });
});
