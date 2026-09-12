/**
 * @vitest-environment happy-dom
 */

// Crew wages count as a cost, and the fee stopped having its own row.
//
// Asked on 12 Sep: "Does this include the employee day rates when on a job as a
// cost? If not it should. We should also just fold motko fees into costs for
// simplicity."
//
// It did not. `team_members.day_rate` is a CHARGE-OUT rate — it prices the
// labour line on the quote — so the one number on file was doing the revenue
// job, and "Costs paid" (job_costs only) saw no wages at all. A trade running a
// crew read a total that could only flatter them.
//
// Two decisions behind this (areas/motko.md, 12 Sep): a SEPARATE cost rate per
// person rather than reusing the charge-out one, and the owner's own days are
// never a cost — they are drawings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { crewCostPennies, type CrewCostMember } from "@/lib/crew-cost";
import { MoneyPositionClient } from "@/app/jobs/money-position-client";
import type { MoneyPosition } from "@/app/jobs/money-position-actions";

afterEach(cleanup);

const roster: CrewCostMember[] = [
  { name: "Liam", cost_day_rate: 110 },
  { name: "Sam Okafor", cost_day_rate: null },
];

const labourLine = (people: { label: string; days: number; day_rate: number }[]) => ({
  description: "Second fix",
  category: "labour",
  quantity: 3,
  unit: "day",
  unit_price: 0,
  multiplier: 1,
  people_count: people.length,
  overtime: false,
  assumed: false,
  people,
});

describe("what the crew cost", () => {
  it("costs a team member's days at their cost rate, not their charge-out rate", () => {
    // Charged out at £150, costs £110. The gap is the margin, and it must
    // survive — costing at £150 would report zero margin on Liam.
    const { pennies } = crewCostPennies(
      [labourLine([{ label: "Liam", days: 3, day_rate: 150 }])],
      roster,
    );
    expect(pennies).toBe(33000);
  });

  it("matches a person whose quote label carries their role", () => {
    // resolvePerson writes "Liam (Apprentice)" when a role is on file.
    const { pennies } = crewCostPennies(
      [labourLine([{ label: "Liam (Apprentice)", days: 2, day_rate: 150 }])],
      roster,
    );
    expect(pennies).toBe(22000);
  });

  it("never costs the owner's own days", () => {
    // Jacob's decision, 12 Sep: the owner's days are drawings. The owner is not
    // a team_members row, so they simply never match.
    const { pennies, uncosted } = crewCostPennies(
      [labourLine([{ label: "Jacob Buckland", days: 5, day_rate: 340 }])],
      roster,
    );
    expect(pennies).toBe(0);
    expect(uncosted).toEqual([]);
  });

  it("names a team member with no cost rate instead of guessing one", () => {
    // The whole point of the optional column. A default of zero would read as
    // "he was free"; a default of the charge-out rate would read as zero margin.
    const { pennies, uncosted } = crewCostPennies(
      [labourLine([{ label: "Sam Okafor", days: 4, day_rate: 200 }])],
      roster,
    );
    expect(pennies).toBe(0);
    expect(uncosted).toEqual(["Sam Okafor"]);
  });

  it("adds up a mixed crew and reports only the person it could not price", () => {
    const { pennies, uncosted } = crewCostPennies(
      [
        labourLine([
          { label: "Liam", days: 3, day_rate: 150 },
          { label: "Sam Okafor", days: 3, day_rate: 200 },
          { label: "Jacob Buckland", days: 3, day_rate: 340 },
        ]),
      ],
      roster,
    );
    expect(pennies).toBe(33000);
    expect(uncosted).toEqual(["Sam Okafor"]);
  });

  it("ignores materials lines, which carry no crew", () => {
    const materials = {
      description: "Plasterboard",
      category: "materials",
      quantity: 20,
      unit: "sheet",
      unit_price: 12,
      multiplier: 1,
      people_count: 1,
      overtime: false,
      assumed: false,
      people: [{ label: "Liam", days: 3, day_rate: 150 }],
    };
    expect(crewCostPennies([materials], roster).pennies).toBe(0);
  });

  it("survives a legacy quote with no crew breakdown at all", () => {
    // `people` post-dates the labour line. An old quote has days and a price and
    // nothing to attribute them to, and that is not an error.
    const legacy = {
      description: "Labour",
      category: "labour",
      quantity: 3,
      unit: "day",
      unit_price: 300,
      multiplier: 1,
      people_count: 2,
      overtime: false,
      assumed: false,
    };
    expect(crewCostPennies([legacy], roster)).toEqual({ pennies: 0, uncosted: [] });
    expect(crewCostPennies(null, roster)).toEqual({ pennies: 0, uncosted: [] });
  });
});

// --------------------------------------------------------------------------
// End to end: a paid invoice with a crew on it, through getMoneyPosition.
//
// The stub is keyed BY TABLE, the shape `tests/acceptance/364.test.ts` uses, so
// the roster query and the invoice query cannot read each other's rows.
// --------------------------------------------------------------------------

type Filters = Record<string, unknown>;
let rows: Record<string, Record<string, unknown>[]>;

const resolvePath = (row: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => {
    if (value === null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, row);

const applyFilters = (table: string, filters: Filters): Record<string, unknown>[] =>
  (rows[table] ?? []).filter((row) =>
    Object.entries(filters).every(([column, value]) => resolvePath(row, column) === value),
  );

const makeQuery = (table: string) => {
  const filters: Filters = {};
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return query;
    },
    single: async () => ({ data: applyFilters(table, filters)[0] ?? null, error: null }),
    maybeSingle: async () => ({
      data: applyFilters(table, filters)[0] ?? null,
      error: null,
    }),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      resolve({ data: applyFilters(table, filters), error: null }),
  };
  return query;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => makeQuery(table),
  }),
}));

describe("wages reach the money position", () => {
  beforeEach(() => {
    vi.resetModules();
    rows = {
      contractors: [
        {
          id: "contractor-1",
          owner_user_id: "user-1",
          vat_registered: false,
          free_jobs_remaining: 3,
        },
      ],
      jobs: [
        {
          id: "job-1",
          contractor_id: "contractor-1",
          fee_amount_pennies: null,
          fee_status: "not_applicable",
        },
      ],
      job_costs: [],
      team_members: [
        { contractor_id: "contractor-1", name: "Liam", cost_day_rate: 110 },
      ],
      invoices: [
        {
          id: "inv-1",
          amount: 1500,
          created_at: "2026-09-01T00:00:00.000Z",
          paid_at: "2026-09-05T00:00:00.000Z",
          status: "paid",
          quotes: {
            job_id: "job-1",
            line_items_json: [labourLine([{ label: "Liam", days: 3, day_rate: 150 }])],
            jobs: {
              contractor_id: "contractor-1",
              customer_id: "cust-1",
              customers: { name: "Smith Ltd" },
            },
          },
        },
      ],
    };
  });

  it("counts three days of Liam as £330 of costs paid", async () => {
    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend.costsPaid).toBe(33000);
    // £1,500 collected, £330 of wages out.
    expect(position.safeToSpend.total).toBe(150000 - 33000);
  });

  it("puts the wages in the same window as the money they earned", async () => {
    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    // Both the invoice and its wages are dated 5 Sep, so a window containing one
    // contains the other. Asserted as a relationship rather than against a fixed
    // quarter, so this does not go red when the calendar rolls over.
    expect(position.period?.crewCost).toBe(position.period?.collected ? 33000 : 0);
    expect(position.period?.costsPaid).toBe(position.period?.crewCost);
  });

  it("reports a crew member with no saved cost rate rather than dropping them", async () => {
    rows.team_members = [
      { contractor_id: "contractor-1", name: "Liam", cost_day_rate: null },
    ];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend.costsPaid).toBe(0);
    expect(position.period?.uncostedCrew).toEqual(["Liam"]);
  });

  it("costs nothing when the contractor has no team at all", async () => {
    rows.team_members = [];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend.costsPaid).toBe(0);
    expect(position.period?.uncostedCrew).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// The card: one row out, not three.
// --------------------------------------------------------------------------

const pence = (testId: string): number => {
  const text = screen.getByTestId(testId).textContent || "";
  return Math.round(parseFloat(text.replace(/[^0-9.-]/g, "")) * 100);
};

const withPeriod = (over: Partial<NonNullable<MoneyPosition["period"]>> = {}): MoneyPosition => ({
  owedToYou: [],
  youOwe: [],
  vat: null,
  whatsLeft: 150000,
  safeToSpend: {
    collected: 150000,
    costsPaid: 33000,
    motkoFees: 2500,
    vatToSetAside: null,
    total: 114500,
  },
  projection: { owedNet: 0, unpaidCostsNet: 0, feesOnOwed: 0, total: 114500 },
  period: {
    kind: "tax-year",
    label: "6 Apr 2026 – 5 Apr 2027",
    collected: 150000,
    costsPaid: 33000,
    motkoFees: 2500,
    vatToSetAside: null,
    total: 114500,
    undatedCollected: 0,
    crewCost: 33000,
    uncostedCrew: [],
    ...over,
  },
});

describe("the card shows one deduction, and says what is in it", () => {
  it("folds the fee into Costs paid", () => {
    render(<MoneyPositionClient position={withPeriod()} />);

    expect(pence("costs-paid")).toBe(35500); // 33000 wages + 2500 fees
    expect(screen.queryByTestId("motko-fees")).toBeNull();
  });

  it("still balances against the total", () => {
    render(<MoneyPositionClient position={withPeriod()} />);
    expect(pence("safe-to-spend")).toBe(pence("collected") - pence("costs-paid"));
  });

  it("names the wages and the fee inside the row, so the number is traceable", () => {
    render(<MoneyPositionClient position={withPeriod()} />);
    expect(screen.getByText(/Includes £330\.00 crew wages and £25\.00 motko fees/)).toBeDefined();
  });

  it("warns about a crew member whose wages are missing from the figure", () => {
    render(<MoneyPositionClient position={withPeriod({ uncostedCrew: ["Sam Okafor"] })} />);
    expect(screen.getByText(/Sam Okafor worked on these jobs with no day cost saved/)).toBeDefined();
  });

  it("says nothing about wages when there are none", () => {
    render(
      <MoneyPositionClient position={withPeriod({ crewCost: 0, motkoFees: 0, costsPaid: 0 })} />,
    );
    expect(screen.queryByText(/crew wages/)).toBeNull();
    expect(screen.queryByText(/no day cost saved/)).toBeNull();
  });

  it("stops claiming it knows nothing about wages, because now it does", () => {
    render(<MoneyPositionClient position={withPeriod()} />);
    expect(screen.queryByText(/does not know about wages/i)).toBeNull();
    expect(screen.getByText(/anyone not on your team list/i)).toBeDefined();
  });

  it("keeps the fee on its own row where there is no period to fold into", () => {
    // A hand-built position — the shape `tests/acceptance/389.test.tsx` renders.
    // That contract reads the four terms out of the DOM separately, and the
    // all-time chain it describes is unchanged by any of this.
    const noPeriod: MoneyPosition = { ...withPeriod(), period: undefined };
    render(<MoneyPositionClient position={noPeriod} />);

    expect(pence("costs-paid")).toBe(33000);
    expect(pence("motko-fees")).toBe(2500);
    expect(pence("safe-to-spend")).toBe(
      pence("collected") - pence("costs-paid") - pence("motko-fees"),
    );
  });
});
