/**
 * @vitest-environment happy-dom
 *
 * 19 SEP: the Money position panel's YOU OWE section never said what you owe.
 *
 * Reported from the dashboard: ten supplier rows between £84 and £268, a "See
 * all 12 counterparties" link, and no total anywhere. The section a contractor
 * opens to find one number was the only one on the panel that made them add it
 * up — COMING IN states its position in a line, MONEY IN AND OUT states
 * Collected and Costs paid, and YOU OWE stated a list.
 *
 * Now: the figure is the section, and the list is behind it.
 *
 * Asserts through the DOM rather than the markup — the claim is about what a
 * contractor can see and reach, and it must survive any correct refactor of
 * the JSX.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MoneyPositionClient } from "@/app/jobs/money-position-client";
import { totalOwedAcrossCounterparties } from "@/lib/money-position-math";
import type { MoneyPosition } from "@/app/jobs/money-position-actions";
import type { CounterpartyAggregate } from "@/lib/money-position-math";

// Required: the vitest config does not set `globals: true`, so Testing
// Library's automatic cleanup never registers itself.
afterEach(cleanup);

// The server actions the panel imports reach Supabase on click. Nothing here
// clicks through to a drill-down, but the module is imported at load.
vi.mock("@/app/jobs/money-position-cost-actions", () => ({
  getCostDetails: async () => [],
  getInvoiceDetails: async () => [],
  markCostsPaid: async () => ({ success: true }),
}));

const supplier = (name: string, pence: number): CounterpartyAggregate => ({
  counterpartyId: `cp-${name.replace(/\s+/g, "-")}`,
  counterpartyName: name,
  totalOwed: pence,
  jobCount: 1,
  costIds: [`cost-${name.replace(/\s+/g, "-")}`],
});

// The reported shape: the first three rows off the dashboard, plus enough
// others to pass the ten-row display limit.
const reported: CounterpartyAggregate[] = [
  supplier("qa auto materials", 26_880),
  supplier("qa auto birch", 18_000),
  supplier("qa auto fixings", 16_800),
  supplier("qa autohelper", 16_000),
  supplier("qa auto yesterday helper", 16_000),
  supplier("qa auto helper", 16_000),
  supplier("qa auto supplies", 12_000),
  supplier("qa auto clarification", 12_000),
  supplier("qa automo", 8_400),
  supplier("qa-auto materials", 8_400),
  supplier("qa auto eleventh", 5_000),
  supplier("qa auto twelfth", 2_500),
];

const position = (youOwe: CounterpartyAggregate[]): MoneyPosition => ({
  owedToYou: [],
  youOwe,
  vat: null,
  whatsLeft: 0,
  safeToSpend: {
    collected: 6_314_044,
    costsPaid: 1_129_380,
    motkoFees: 0,
    vatToSetAside: null,
    total: 5_184_664,
  },
  projection: { owedNet: 0, unpaidCostsNet: 0, feesOnOwed: 0, total: 5_184_664 },
});

describe("what the section says before you open it", () => {
  it("states the total owed", () => {
    render(<MoneyPositionClient position={position(reported)} />);

    // £1,579.80 across the twelve. The number a contractor came for.
    expect(screen.getByText("£1,579.80")).toBeDefined();
  });

  it("agrees with the derivation rather than re-adding it in the view", () => {
    // Guards the one way this could drift: the panel computing its own sum.
    expect(totalOwedAcrossCounterparties(reported)).toBe(157_980);
  });

  it("says how many suppliers are behind the figure", () => {
    render(<MoneyPositionClient position={position(reported)} />);

    expect(screen.getByText("across 12 suppliers")).toBeDefined();
  });

  it("does not list the suppliers", () => {
    render(<MoneyPositionClient position={position(reported)} />);

    expect(
      screen.queryByText("qa auto materials"),
      "ten supplier rows sat between the two sections this panel is read for",
    ).toBeNull();
  });

  it("offers a control, named by the figure, that says it is closed", () => {
    render(<MoneyPositionClient position={position(reported)} />);

    const control = screen.getByRole("button", { name: /across 12 suppliers/i });
    expect(control.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("what opening it gives back", () => {
  it("lists the suppliers", () => {
    render(<MoneyPositionClient position={position(reported)} />);
    fireEvent.click(screen.getByRole("button", { name: /across 12 suppliers/i }));

    expect(screen.getByText("qa auto materials")).toBeDefined();
    expect(screen.getByText("qa auto birch")).toBeDefined();
  });

  it("keeps the ten-row limit and its See all", () => {
    // Unchanged behaviour: the cut is already sensible, since the rows are
    // sorted biggest first and only the two smallest are hidden.
    render(<MoneyPositionClient position={position(reported)} />);
    fireEvent.click(screen.getByRole("button", { name: /across 12 suppliers/i }));

    expect(screen.queryByText("qa auto twelfth")).toBeNull();
    expect(screen.getByRole("button", { name: /See all 12 counterparties/i })).toBeDefined();
  });

  it("keeps the total visible while open", () => {
    // The figure is the heading, not a placeholder the list replaces.
    render(<MoneyPositionClient position={position(reported)} />);
    fireEvent.click(screen.getByRole("button", { name: /across 12 suppliers/i }));

    expect(screen.getByText("£1,579.80")).toBeDefined();
  });

  it("closes again", () => {
    render(<MoneyPositionClient position={position(reported)} />);
    fireEvent.click(screen.getByRole("button", { name: /across 12 suppliers/i }));
    fireEvent.click(screen.getByRole("button", { name: /across 12 suppliers/i }));

    expect(screen.queryByText("qa auto materials")).toBeNull();
  });
});

describe("with nothing owed", () => {
  it("says so plainly and offers nothing to open", () => {
    render(<MoneyPositionClient position={position([])} />);

    expect(screen.getByText("All costs paid")).toBeDefined();
    expect(screen.queryByRole("button", { name: /across/i })).toBeNull();
  });
});

describe("with one supplier", () => {
  it("counts in the singular", () => {
    render(<MoneyPositionClient position={position([supplier("qa auto birch", 18_000)])} />);

    expect(screen.getByText("across 1 supplier")).toBeDefined();
  });
});
