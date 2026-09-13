/**
 * @vitest-environment happy-dom
 */

// "Switch to fixed price" restructured the whole quote on one unguarded click.
//
// Reported 13 Sep. #730 fixed the destructive half — the switch now records
// what it collapsed, so it is reversible. This is the other half of the same
// report: the control sits beside "Save changes", fires a server write on a
// single click, and replaces every itemised line with one works line, with
// nothing asked and nothing named.
//
// The confirmation names the figure about to be collapsed, because "how much
// am I about to lose sight of" is the question a contractor actually has. It
// is only asked when there is something to lose — a quote with no priced work
// has nothing to collapse, and being asked then is friction for no reason.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuoteEditor } from "@/app/jobs/[id]/quote-editor";
import type { LineItem } from "@/lib/schemas/job";

afterEach(cleanup);
// Each case asserts on the call COUNT, so one test's click must not satisfy
// another's assertion.
beforeEach(() => vi.clearAllMocks());

const switchPricingMode = vi.fn(async (_input?: unknown) => ({ lineItems: [], total: 0 }));

vi.mock("@/app/jobs/actions", () => ({
  setQuotePricingMode: (input?: unknown) => switchPricingMode(input),
  updateQuoteLineItems: vi.fn(async (_input?: unknown) => ({ total: 0 })),
  sendQuote: vi.fn(async (_input?: unknown) => ({ ok: true })),
  redraftJob: vi.fn(async (_input?: unknown) => ({ lineItemCount: 0 })),
  reportVoicePipelineFailure: vi.fn(async (_input?: unknown) => {}),
}));

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Plastering",
  category: "labour",
  quantity: 3,
  unit: "day",
  unit_price: 250,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

const PRICED = [line({}), line({ description: "Plaster", category: "materials", quantity: 10, unit: "bag", unit_price: 12.5 })];

const renderEditor = (lineItems: LineItem[]) =>
  render(
    <QuoteEditor
      jobId="job_1"
      quoteId="quote_1"
      jobTitle="Plastering, Ely"
      initialLineItems={lineItems}
      vatRegistered={false}
      initialPricingMode="calculated"
      initialFixedAmount={null}
      draftExpected={false}
      contractorFlags={[]}
      quoteStatus="draft"
    />,
  );

const clickSwitch = () =>
  fireEvent.click(screen.getByRole("button", { name: /Switch to fixed price/i }));

describe("a quote with priced work", () => {
  it("does not switch on the first click", () => {
    renderEditor(PRICED);
    clickSwitch();
    expect(switchPricingMode).not.toHaveBeenCalled();
  });

  it("names the figure about to be collapsed", () => {
    renderEditor(PRICED);
    clickSwitch();
    // 3 x 250 + 10 x 12.50 = 875
    // Scoped to the confirm card's own sentence — the figure also appears in
    // the subtotal row, and an unscoped query matches both.
    expect(screen.getByText(/totalling £875\.00/)).toBeDefined();
  });

  it("says the lines come back, because they now do", () => {
    renderEditor(PRICED);
    clickSwitch();
    expect(screen.getByText(/Switching back to itemised brings them again/i)).toBeDefined();
  });

  it("switches once confirmed", () => {
    renderEditor(PRICED);
    clickSwitch();
    fireEvent.click(screen.getByRole("button", { name: /Yes, use a fixed price/i }));
    expect(switchPricingMode).toHaveBeenCalledTimes(1);
  });

  it("does not switch when the contractor backs out", () => {
    renderEditor(PRICED);
    clickSwitch();
    fireEvent.click(screen.getByRole("button", { name: /Keep the itemised lines/i }));
    expect(switchPricingMode).not.toHaveBeenCalled();
  });

  it("puts the control back after backing out", () => {
    renderEditor(PRICED);
    clickSwitch();
    fireEvent.click(screen.getByRole("button", { name: /Keep the itemised lines/i }));
    expect(screen.getByRole("button", { name: /Switch to fixed price/i })).toBeDefined();
  });
});

describe("a quote with nothing to collapse", () => {
  it("switches straight away — asking would be friction for no reason", () => {
    renderEditor([]);
    clickSwitch();
    expect(switchPricingMode).toHaveBeenCalledTimes(1);
  });

  it("also switches straight away when the lines total nothing", () => {
    renderEditor([line({ unit_price: 0 })]);
    clickSwitch();
    expect(switchPricingMode).toHaveBeenCalledTimes(1);
  });
});
