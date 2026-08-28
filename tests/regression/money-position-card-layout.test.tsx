/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MoneyPositionClient } from "@/app/jobs/money-position-client";
import type { MoneyPosition } from "@/app/jobs/money-position-actions";

// #389 shipped with fourteen green acceptance tests and two defects, because
// every one of those tests asked what the card COMPUTES and none asked where
// anything SITS:
//
//   1. The owed list rendered twice — once as the old "Owed to you" section of
//      drill-down buttons, once again as a new static "Coming in" block. The
//      same customer and the same figure, a hundred pixels apart.
//   2. The VAT estimate disclaimer never moved. It stayed under the whole
//      chain, below SAFE TO SPEND — which is the exact placement the ticket was
//      written to fix, because it reads as though the total is an estimate.
//
// Both are properties of the rendered document, so both are asserted here on
// the rendered document: what a reader can perceive, and in what order.

vi.mock("@/app/jobs/money-position-cost-actions", () => ({
  getCostDetails: vi.fn(async () => []),
  getInvoiceDetails: vi.fn(async () => []),
  markCostsPaid: vi.fn(async () => ({ ok: true })),
}));

afterEach(cleanup);

/** The spec's own worked example: £240.00 gross owed, £99.20 safe to spend. */
const vatRegistered = {
  owedToYou: [
    {
      customerId: "cust-1",
      customerName: "Jacob Buckland",
      totalOwed: 24000,
      oldestInvoiceAgeDays: 3,
      unpaidInvoiceIds: ["inv-1"],
    },
  ],
  youOwe: [],
  vat: { collected: 1984, onCosts: 0, position: 1984 },
  whatsLeft: 11904,
  safeToSpend: {
    collected: 11904,
    costsPaid: 0,
    motkoFees: 0,
    vatToSetAside: 1984,
    total: 9920,
  },
  projection: { owedNet: 20000, unpaidCostsNet: 0, feesOnOwed: 0, total: 29920 },
} as unknown as MoneyPosition;

const notRegistered = {
  ...vatRegistered,
  vat: null,
  safeToSpend: { ...vatRegistered.safeToSpend, vatToSetAside: null, total: 11904 },
} as unknown as MoneyPosition;

const DISCLAIMER = /Estimate only, not tax advice/;

describe("the owed list appears exactly once", () => {
  it("does not print the same customer twice", () => {
    render(<MoneyPositionClient position={vatRegistered} />);
    expect(screen.getAllByText("Jacob Buckland")).toHaveLength(1);
  });

  it("does not print the same figure twice", () => {
    // The duplicate was inert text rather than a second query, so counting
    // elements is not enough — count the money on screen.
    render(<MoneyPositionClient position={vatRegistered} />);
    const occurrences = (document.body.textContent ?? "").match(/£240\.00/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("calls the section COMING IN, and keeps it above the chain", () => {
    render(<MoneyPositionClient position={vatRegistered} />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent ?? "");
    const comingIn = headings.findIndex((h) => /Coming in/i.test(h));
    const chain = headings.findIndex((h) => /MONEY IN AND OUT/i.test(h));

    expect(comingIn, "COMING IN should be a heading on the card").toBeGreaterThan(-1);
    expect(comingIn).toBeLessThan(chain);
  });

  it("keeps the row interactive, so the drill-down is not lost to the rename", () => {
    // The duplicate that was removed was the inert copy. Deleting the wrong one
    // would silently retire the customer drill-down.
    render(<MoneyPositionClient position={vatRegistered} />);
    expect(screen.getByRole("button", { name: /Jacob Buckland/ })).toBeDefined();
  });

  it("retires the old heading", () => {
    render(<MoneyPositionClient position={vatRegistered} />);
    expect(screen.queryByText("Owed to you")).toBeNull();
  });
});

describe("the estimate disclaimer sits on the VAT line, not under the total", () => {
  /** Where a piece of text falls in document order. */
  const positionOf = (pattern: RegExp | string): number => {
    const text = document.body.textContent ?? "";
    const index = typeof pattern === "string" ? text.indexOf(pattern) : text.search(pattern);
    expect(index, `expected to find ${pattern} on the card`).toBeGreaterThan(-1);
    return index;
  };

  it("renders after the VAT row", () => {
    render(<MoneyPositionClient position={vatRegistered} />);
    expect(positionOf("VAT to set aside")).toBeLessThan(positionOf(DISCLAIMER));
  });

  it("renders BEFORE safe to spend, so the total does not read as an estimate", () => {
    // This is the whole defect. The disclaimer used to follow the total, which
    // is what the ticket describes as "implying the total is an estimate".
    render(<MoneyPositionClient position={vatRegistered} />);
    expect(positionOf(DISCLAIMER)).toBeLessThan(positionOf("Safe to spend"));
  });

  it("goes away entirely when the trade is not VAT-registered", () => {
    // Nothing on the chain is estimated then, so nothing should say it is.
    render(<MoneyPositionClient position={notRegistered} />);
    expect(document.body.textContent ?? "").not.toMatch(DISCLAIMER);
  });
});

describe("the chain itself is unchanged by the move", () => {
  const pence = (testId: string): number =>
    Math.round(
      Number((screen.getByTestId(testId).textContent ?? "").replace(/[^0-9.-]/g, "")) * 100,
    );

  it("still totals to what it displays", () => {
    render(<MoneyPositionClient position={vatRegistered} />);
    expect(
      pence("collected") - pence("costs-paid") - pence("motko-fees") - pence("vat-set-aside"),
    ).toBe(pence("safe-to-spend"));
  });

  it("still projects from net owed rather than the gross COMING IN figure", () => {
    // £299.20, not £339.20 — the error the spec calls out by name, re-asserted
    // here because COMING IN moved and this is what would break if the
    // projection ever started reading it.
    render(<MoneyPositionClient position={vatRegistered} />);
    expect(screen.getByTestId("projection-total").textContent).toBe("£299.20");
  });
});
