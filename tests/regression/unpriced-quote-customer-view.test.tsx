/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// A quote line the compiler could not price has no figure behind it. The PDF
// has always said so. The HTML quote page — the one the customer actually
// opens from the link in their email — rendered it as £0.00 under a confident
// "Total", which is a wrong number on a customer-facing document. These tests
// hold the two surfaces to the same story, and hold the accept path shut.

const h = vi.hoisted(() => {
  const notify = vi.fn();
  const state: { quoteRow: unknown; updateResult: { data: unknown; error: unknown } } = {
    quoteRow: undefined,
    updateResult: { data: [{ id: "q-1" }], error: null },
  };

  const admin = {
    from: () => {
      const b: Record<string, unknown> = { _upd: false };
      b.select = () => (b._upd ? Promise.resolve(state.updateResult) : b);
      b.update = () => {
        b._upd = true;
        return b;
      };
      b.eq = () => b;
      b.maybeSingle = () => Promise.resolve({ data: state.quoteRow, error: null });
      return b;
    },
  };

  return { notify, state, admin };
});

vi.mock("@/lib/notify-contractor", () => ({ notifyContractorOfCustomerAction: h.notify }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));

import { acceptQuote } from "@/app/q/[id]/actions";
import { QuoteResponse } from "@/app/q/[id]/quote-response";
import {
  incompleteQuoteNote,
  PARTIAL_TOTAL_LABEL,
  UNPRICED_ACCEPT_BLOCKED,
  UNPRICED_ACCEPT_REFUSED,
  UNPRICED_AMOUNT_LABEL,
  UNPRICED_LINE_NOTE,
} from "@/lib/unpriced-quote-copy";

afterEach(cleanup);

const jobRow = { job_id: "job-1", job: { customer: { name: "Dave" } } };

describe("acceptQuote refuses a quote that isn't fully priced", () => {
  beforeEach(() => {
    h.notify.mockReset();
    h.state.updateResult = { data: [{ id: "q-1" }], error: null };
  });

  it("throws, and never writes an acceptance, when a line is unpriced", async () => {
    h.state.quoteRow = {
      ...jobRow,
      line_items_json: [
        { description: "Materials", quantity: 1, unit_price: 120 },
        { description: "Labour", quantity: 1, unit_price: 0, unpriced: true },
      ],
    };

    await expect(acceptQuote("q-1")).rejects.toThrow(UNPRICED_ACCEPT_REFUSED);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("still accepts a fully priced quote", async () => {
    h.state.quoteRow = {
      ...jobRow,
      line_items_json: [{ description: "Labour", quantity: 1, unit_price: 340 }],
    };

    await acceptQuote("q-1");
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("accepts a legacy quote whose rows predate the unpriced marker", async () => {
    // Explicit: rows written before `unpriced` existed carry no marker, so they
    // are treated as priced. Nothing retroactively blocks them.
    h.state.quoteRow = { ...jobRow, line_items_json: null };

    await acceptQuote("q-1");
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
});

describe("QuoteResponse", () => {
  it("withholds Accept and says why when a line is unpriced", () => {
    render(<QuoteResponse quoteId="q-1" status="sent" fullyPriced={false} />);

    expect(screen.queryByRole("button", { name: "Accept quote" })).toBeNull();
    expect(screen.getByText(UNPRICED_ACCEPT_BLOCKED)).toBeDefined();
  });

  it("still lets the customer decline an unpriced quote", () => {
    render(<QuoteResponse quoteId="q-1" status="sent" fullyPriced={false} />);

    expect(screen.getByRole("button", { name: "Decline quote" })).toBeDefined();
  });

  it("offers Accept normally when the quote is fully priced", () => {
    render(<QuoteResponse quoteId="q-1" status="sent" fullyPriced />);

    expect(screen.getByRole("button", { name: "Accept quote" })).toBeDefined();
    expect(screen.queryByText(UNPRICED_ACCEPT_BLOCKED)).toBeNull();
  });
});

describe("the HTML quote page says what the PDF says", () => {
  const page = readFileSync("src/app/q/[id]/page.tsx", "utf8");
  const pdf = readFileSync("src/lib/pdf/quote-pdf.tsx", "utf8");

  it("never prints a money figure for an unpriced line", () => {
    // The whole defect in one assertion: the amount cell must branch on
    // `unpriced` before it reaches formatGBP.
    expect(page).toContain("item.unpriced ? UNPRICED_AMOUNT_LABEL : formatGBP(lineItemTotal(item))");
  });

  it("labels a partial total as partial and explains the omission", () => {
    expect(page).toContain("hasUnpriced ? PARTIAL_TOTAL_LABEL");
    expect(page).toContain("incompleteQuoteNote(unpricedCount)");
  });

  it("uses the same wording the PDF renders", () => {
    // quote-pdf.tsx keeps its own literals because it is pinned by golden
    // baselines; re-pointing it at these constants is a re-baseline and
    // belongs in its own commit. Until then, this is what stops them drifting.
    expect(pdf).toContain(UNPRICED_AMOUNT_LABEL);
    expect(pdf).toContain(UNPRICED_LINE_NOTE);
    expect(pdf).toContain(PARTIAL_TOTAL_LABEL);
    expect(pdf).toContain("still to be priced and");
  });

  it("phrases the incompleteness note for one item and for several", () => {
    expect(incompleteQuoteNote(1)).toContain("1 item is still to be priced and is not");
    expect(incompleteQuoteNote(3)).toContain("3 items are still to be priced and are not");
  });
});
