/**
 * @vitest-environment happy-dom
 */

// Editing a line item and tapping "Send quote" without first tapping "Save
// changes" sent the PREVIOUS figures.
//
// sendQuote reads line_items_json and total back off the row (actions.ts), and
// send() never persisted. So the customer received the old numbers on both the
// message and the page, and the edit was discarded when the editor unmounted on
// navigation. The contractor watched the new figure the whole time, because the
// header total is a useMemo over local state.
//
// Nothing gated the button on the dirty flag either: `saved` existed and was
// simply never read by the send path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  // Declared, not inferred. A zero-argument mock makes mock.calls[0][0]
  // unreachable to the compiler (AGENTS.md), and this test's whole point is
  // asserting WHAT got persisted.
  updateQuoteLineItems: vi.fn<
    (input: {
      jobId: string;
      quoteId: string;
      lineItems: { unit_price: number }[];
    }) => Promise<void>
  >(async () => {}),
  sendQuote: vi.fn(async () => ({
    delivered: true,
    email: { attempted: true, delivered: true },
    sms: { attempted: false, delivered: false },
    quoteUrl: "https://example.test/q/1",
  })),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../../src/app/jobs/actions", () => ({
  updateQuoteLineItems: h.updateQuoteLineItems,
  sendQuote: h.sendQuote,
  redraftJob: vi.fn(async () => ({ lineItemCount: 1 })),
  reportEmptyQuoteDraft: vi.fn(async () => {}),
  setQuotePricingMode: vi.fn(async () => ({ lineItems: [], total: 0 })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}));

import { QuoteEditor } from "@/app/jobs/[id]/quote-editor";
import type { LineItem } from "@/lib/schemas/job";

afterEach(cleanup);

const lineItem = {
  description: "Downlights works",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 20,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
} as LineItem;

const renderEditor = () =>
  render(
    <QuoteEditor
      jobId="00000000-0000-4000-8000-000000000001"
      quoteId="00000000-0000-4000-8000-000000000002"
      jobTitle="Downlights"
      initialLineItems={[lineItem]}
      vatRegistered
      initialCustomerName="Luca Feser"
      initialCustomerEmail="luca@example.test"
    />,
  );

/** Changes a unit price, which marks the editor dirty. */
const editUnitPrice = (next: string) => {
  const input = screen
    .getAllByRole("spinbutton")
    .find((el) => (el as HTMLInputElement).value === "20");
  expect(input).toBeDefined();
  fireEvent.change(input as HTMLInputElement, { target: { value: next } });
};

const clickSend = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Send quote/i }));
  });
};

describe("Send persists pending edits first", () => {
  beforeEach(() => {
    h.updateQuoteLineItems.mockClear();
    h.sendQuote.mockClear();
    h.updateQuoteLineItems.mockImplementation(async () => {});
  });

  it("saves BEFORE it sends — asserted on call order, not just on both being called", async () => {
    renderEditor();
    editUnitPrice("35");
    await clickSend();

    expect(h.updateQuoteLineItems).toHaveBeenCalledTimes(1);
    expect(h.sendQuote).toHaveBeenCalledTimes(1);
    expect(h.updateQuoteLineItems.mock.invocationCallOrder[0]).toBeLessThan(
      h.sendQuote.mock.invocationCallOrder[0],
    );
  });

  it("persists the edited figure, not the one the quote was loaded with", async () => {
    renderEditor();
    editUnitPrice("35");
    await clickSend();

    expect(h.updateQuoteLineItems.mock.calls[0][0].lineItems[0].unit_price).toBe(35);
  });

  it("ABORTS the send when the persist fails", async () => {
    // Sending stale figures silently is the defect; doing it after a visible
    // write failure would be worse.
    h.updateQuoteLineItems.mockImplementation(async () => {
      throw new Error("row is locked");
    });

    renderEditor();
    editUnitPrice("35");
    await clickSend();

    expect(h.sendQuote).not.toHaveBeenCalled();
    expect(screen.getByText(/Couldn't save/i)).toBeDefined();
  });

  it("does not take a redundant write when nothing was edited", async () => {
    renderEditor();
    await clickSend();

    expect(h.updateQuoteLineItems).not.toHaveBeenCalled();
    expect(h.sendQuote).toHaveBeenCalledTimes(1);
  });
});
