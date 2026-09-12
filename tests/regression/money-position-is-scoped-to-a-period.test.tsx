/**
 * @vitest-environment happy-dom
 */

// The money card stopped being a lifetime running total.
//
// Reported 11 Sep: "Collected £2,232.00 … Safe to spend £2,232.00" with no date
// bound anywhere. Every figure summed all time, so the number could only grow,
// and it drifted wrong in OPPOSITE directions depending on the trade:
//
//   not VAT-registered — drifts UP. Wages, the van, fuel and drawings never
//   enter job_costs, so collected outruns costs forever and money spent months
//   ago still counted as "safe to spend".
//
//   VAT-registered — drifts DOWN. vatToSetAside was the VAT on every paid
//   invoice ever, never reduced by the returns actually filed, so it kept
//   setting aside money already paid over to HMRC.
//
// Jacob chose (a) scope it to the VAT quarter / tax year AND (d) stop calling it
// spendable. Both are here.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MoneyPositionClient } from "@/app/jobs/money-position-client";
import {
  currentMoneyPeriod,
  currentTaxYear,
  currentVatQuarter,
  isWithinPeriod,
} from "@/lib/money-period";
import type { MoneyPosition } from "@/app/jobs/money-position-actions";

afterEach(cleanup);

// Deliberately the same helper `tests/acceptance/389.test.tsx` uses, including
// its quirk: the card renders a Unicode MINUS SIGN (U+2212), which this strips.
// So a deduction reads POSITIVE here and the chain is checked by subtracting.
const pence = (testId: string): number => {
  const text = screen.getByTestId(testId).textContent || "";
  return Math.round(parseFloat(text.replace(/[^0-9.-]/g, "")) * 100);
};

/** All-time figures deliberately much larger than the period's. */
const base: MoneyPosition = {
  owedToYou: [],
  youOwe: [],
  vat: { collected: 40000, onCosts: 0, position: 40000 },
  whatsLeft: 240000,
  safeToSpend: {
    collected: 240000,
    costsPaid: 0,
    motkoFees: 0,
    vatToSetAside: 40000,
    total: 200000,
  },
  projection: { owedNet: 0, unpaidCostsNet: 0, feesOnOwed: 0, total: 200000 },
  period: {
    kind: "vat-quarter",
    label: "1 Jul – 30 Sep 2026",
    collected: 60000,
    costsPaid: 5000,
    motkoFees: 1000,
    vatToSetAside: 10000,
    total: 44000,
    undatedCollected: 0,
    crewCost: 0,
    uncostedCrew: [],
  },
};

describe("what the card leads with", () => {
  it("shows the PERIOD figures, not the lifetime ones", () => {
    render(<MoneyPositionClient position={base} />);

    expect(pence("collected")).toBe(60000);
    // Costs and fees are ONE row now — 5000 recorded + 1000 in fees.
    expect(pence("costs-paid")).toBe(6000);
    expect(pence("vat-set-aside")).toBe(10000);
    expect(pence("safe-to-spend")).toBe(44000);
  });

  it("keeps the chain summing to the total actually on screen", () => {
    render(<MoneyPositionClient position={base} />);

    expect(pence("safe-to-spend")).toBe(
      pence("collected") - pence("costs-paid") - pence("vat-set-aside"),
    );
  });

  it("names the window, so nobody has to guess which one they are looking at", () => {
    render(<MoneyPositionClient position={base} />);
    expect(screen.getByText(/1 Jul – 30 Sep 2026/)).toBeDefined();
  });

  it("no longer calls it SAFE TO SPEND", () => {
    // (d). It was never a spendable balance: motko sees costs recorded against
    // jobs, not wages, the van, fuel or drawings.
    render(<MoneyPositionClient position={base} />);
    expect(screen.queryByText("Safe to spend")).toBeNull();
    // Twice over: the chain's total, and the first line of "How this is
    // calculated", which must name the same thing it starts from.
    expect(screen.getAllByText(/Left from this quarter/).length).toBeGreaterThan(0);
  });

  it("says what it cannot see, rather than implying it saw everything", () => {
    render(<MoneyPositionClient position={base} />);
    expect(screen.getByText(/doesn't know about the van, fuel, rent/i)).toBeDefined();
  });

  it("calls it a tax year for a trade with no VAT quarter", () => {
    render(
      <MoneyPositionClient
        position={{
          ...base,
          safeToSpend: { ...base.safeToSpend, vatToSetAside: null },
          period: {
            ...base.period!,
            kind: "tax-year",
            label: "6 Apr 2026 – 5 Apr 2027",
            vatToSetAside: null,
            total: 54000,
          },
        }}
      />,
    );

    expect(screen.getAllByText(/Left from this tax year/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("vat-set-aside")).toBeNull();
  });
});

describe("the all-time figures are kept, and labelled as all-time", () => {
  it("still shows them", () => {
    render(<MoneyPositionClient position={base} />);

    expect(pence("all-time-collected")).toBe(240000);
    expect(pence("all-time-total")).toBe(200000);
  });

  it("does not call the lifetime total spendable either", () => {
    render(<MoneyPositionClient position={base} />);
    expect(screen.getByText("Net through motko, all time")).toBeDefined();
  });

  it("declares money that falls into no period rather than swallowing it", () => {
    // Without this the all-time figure can exceed the sum of every period and
    // nothing on the card explains the gap.
    render(
      <MoneyPositionClient
        position={{ ...base, period: { ...base.period!, undatedCollected: 12345 } }}
      />,
    );
    expect(screen.getByText(/no recorded payment date/i)).toBeDefined();
  });
});

describe("the projection agrees with the total above it", () => {
  it("is reckoned from the period total, not the lifetime one", () => {
    // Showing a period chain above a projection built from the lifetime chain
    // would put two numbers on the card that cannot be reconciled by looking at
    // it — the fault this card exists to remove.
    render(
      <MoneyPositionClient
        position={{
          ...base,
          projection: { owedNet: 20000, unpaidCostsNet: 500, feesOnOwed: 300, total: 219200 },
        }}
      />,
    );

    // 44000 + 20000 − 500 − 300, from the PERIOD total.
    expect(pence("projection-total")).toBe(63200);
  });
});

describe("a position with no period at all", () => {
  // How `tests/acceptance/389.test.tsx` drives this component: a hand-built
  // literal with no `period`. The fallback is what keeps that frozen file green.
  const noPeriod: MoneyPosition = { ...base, period: undefined };

  it("falls back to the all-time chain", () => {
    render(<MoneyPositionClient position={noPeriod} />);

    expect(pence("collected")).toBe(240000);
    expect(pence("safe-to-spend")).toBe(200000);
  });

  it("keeps the chain summing to its own total", () => {
    render(<MoneyPositionClient position={noPeriod} />);

    expect(pence("safe-to-spend")).toBe(
      pence("collected") - pence("costs-paid") - pence("motko-fees") - pence("vat-set-aside"),
    );
  });

  it("offers no all-time section, because the whole card already is one", () => {
    render(<MoneyPositionClient position={noPeriod} />);
    expect(screen.queryByTestId("all-time-collected")).toBeNull();
  });
});

describe("which window a date falls in", () => {
  it("reads calendar quarters", () => {
    const q = currentVatQuarter(new Date("2026-09-11T10:00:00Z"));
    expect(q.start).toBe("2026-07-01");
    expect(q.end).toBe("2026-09-30");
    expect(q.label).toBe("1 Jul – 30 Sep 2026");
  });

  it("gets the quarter ends right, including February", () => {
    expect(currentVatQuarter(new Date("2026-01-15T00:00:00Z")).end).toBe("2026-03-31");
    expect(currentVatQuarter(new Date("2026-12-31T23:00:00Z")).end).toBe("2026-12-31");
    // A leap year, to catch a hard-coded 28.
    expect(currentVatQuarter(new Date("2028-02-01T00:00:00Z")).end).toBe("2028-03-31");
  });

  it("runs the tax year 6 April to 5 April", () => {
    expect(currentTaxYear(new Date("2026-09-11T00:00:00Z")).start).toBe("2026-04-06");
    expect(currentTaxYear(new Date("2026-09-11T00:00:00Z")).end).toBe("2027-04-05");
  });

  it("puts 5 April in the OLD tax year and 6 April in the new one", () => {
    // The boundary is the whole point of a tax year and is off by one all over
    // the industry.
    expect(currentTaxYear(new Date("2026-04-05T12:00:00Z")).start).toBe("2025-04-06");
    expect(currentTaxYear(new Date("2026-04-06T12:00:00Z")).start).toBe("2026-04-06");
  });

  it("gives a VAT-registered trade the quarter and everyone else the tax year", () => {
    const now = new Date("2026-09-11T00:00:00Z");
    expect(currentMoneyPeriod(now, true).kind).toBe("vat-quarter");
    expect(currentMoneyPeriod(now, false).kind).toBe("tax-year");
  });

  it("includes both ends of the window", () => {
    const q = currentVatQuarter(new Date("2026-09-11T00:00:00Z"));
    expect(isWithinPeriod("2026-07-01", q)).toBe(true);
    expect(isWithinPeriod("2026-09-30T23:59:59.000Z", q)).toBe(true);
    expect(isWithinPeriod("2026-06-30T23:59:59.000Z", q)).toBe(false);
    expect(isWithinPeriod("2026-10-01", q)).toBe(false);
  });

  it("places a row with NO date in no period at all", () => {
    // It cannot be placed on the evidence available, and guessing would put
    // money in a quarter on none. It stays in the all-time figures.
    const q = currentVatQuarter(new Date("2026-09-11T00:00:00Z"));
    expect(isWithinPeriod(null, q)).toBe(false);
    expect(isWithinPeriod(undefined, q)).toBe(false);
    expect(isWithinPeriod("", q)).toBe(false);
  });
});
