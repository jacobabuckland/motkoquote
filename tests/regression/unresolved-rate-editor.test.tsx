/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QuoteEditor } from "@/app/jobs/[id]/quote-editor";
import { UNRESOLVED_RATE_FLAG } from "@/lib/compile-draft";
import type { LineItem } from "@/lib/schemas/job";

// Server actions and navigation are the editor's only outward edges; neither is
// under test here. What is under test is whether a contractor opening the
// editor can SEE the unresolved rate before they send.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/jobs/actions", () => ({
  updateQuoteLineItems: vi.fn(),
  sendQuote: vi.fn(),
  redraftJob: vi.fn(),
  reportEmptyQuoteDraft: vi.fn(),
  setQuotePricingMode: vi.fn(),
}));

afterEach(cleanup);

const unpricedLabour: LineItem = {
  description: "Full rewire - three-bed semi",
  category: "labour",
  quantity: 5,
  unit: "day",
  unit_price: 0,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  people: [{ label: "Owner", days: 5, day_rate: 0 }],
  unpriced: true,
};

const renderEditor = (contractorFlags: string[]) =>
  render(
    <QuoteEditor
      jobId="job-1"
      quoteId="quote-1"
      jobTitle="Full rewire"
      initialLineItems={[unpricedLabour]}
      contractorFlags={contractorFlags}
      vatRegistered={false}
    />,
  );

describe("the quote editor before send", () => {
  it("shows the unresolved rate, in full, without the contractor expanding anything", () => {
    renderEditor([UNRESOLVED_RATE_FLAG]);

    // The panel announces itself...
    expect(screen.getByText(/Before you send \(1\)/)).toBeTruthy();
    // ...and the flag's own words are on screen, naming the rate as the cause
    // and where to fix it.
    expect(screen.getByText(UNRESOLVED_RATE_FLAG)).toBeTruthy();
    expect(UNRESOLVED_RATE_FLAG).toMatch(/day rate/i);
    expect(UNRESOLVED_RATE_FLAG).toMatch(/business details/i);
  });

  it("shows no such panel when the rate resolved", () => {
    renderEditor([]);
    expect(screen.queryByText(/Before you send/)).toBeNull();
  });
});
