/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);

describe("#736: The P&L says nothing until there's something to say", () => {
  it("shows empty state message when no invoice and no costs", async () => {
    const mod = await import("@/app/jobs/[id]/job-pnl");
    const { JobPnL } = mod;

    const data = {
      invoicedNet: 0,
      costsNet: 0,
      grossProfit: 0,
      marginPct: null,
      unpaidCosts: 0,
      hasInvoice: false,
    };

    render(<JobPnL data={data} contractorVatRegistered={false} />);

    // Must not show any bold currency figure
    expect(screen.queryByText(/£0\.00/)).toBeNull();

    // Must show the empty state message
    expect(
      screen.getByText(/nothing.*invoiced.*no costs.*recorded/i)
    ).toBeDefined();

    // The footnote must still appear
    expect(
      screen.getByText(/estimate only.*not tax advice/i)
    ).toBeDefined();
  });

  it("shows full breakdown when no invoice but costs exist", async () => {
    const mod = await import("@/app/jobs/[id]/job-pnl");
    const { JobPnL } = mod;

    const data = {
      invoicedNet: 0,
      costsNet: 4000, // £40.00
      grossProfit: -4000,
      marginPct: null,
      unpaidCosts: 0,
      hasInvoice: false,
    };

    render(<JobPnL data={data} contractorVatRegistered={false} />);

    // Full breakdown must appear
    expect(screen.getByText(/invoiced.*net/i)).toBeDefined();
    expect(screen.getByText(/costs.*net/i)).toBeDefined();
    expect(screen.getByText(/gross profit/i)).toBeDefined();

    // The £40 cost must be visible
    expect(screen.getByText(/£40\.00/)).toBeDefined();

    // The footnote must still appear
    expect(
      screen.getByText(/estimate only.*not tax advice/i)
    ).toBeDefined();
  });

  it("shows full breakdown when invoice exists but no costs", async () => {
    const mod = await import("@/app/jobs/[id]/job-pnl");
    const { JobPnL } = mod;

    const data = {
      invoicedNet: 50000, // £500.00
      costsNet: 0,
      grossProfit: 50000,
      marginPct: 100,
      unpaidCosts: 0,
      hasInvoice: true,
    };

    render(<JobPnL data={data} contractorVatRegistered={false} />);

    // Full breakdown must appear
    expect(screen.getByText(/invoiced.*net/i)).toBeDefined();
    expect(screen.getByText(/costs.*net/i)).toBeDefined();
    expect(screen.getByText(/gross profit/i)).toBeDefined();

    // The £500 invoice amount must be visible (checking for multiple is expected)
    const amounts = screen.getAllByText(/£500\.00/);
    expect(amounts.length).toBeGreaterThan(0);

    // A £0.00 for costs should appear (genuine zero result, not empty state)
    expect(screen.getByText(/£0\.00/)).toBeDefined();

    // The footnote must still appear
    expect(
      screen.getByText(/estimate only.*not tax advice/i)
    ).toBeDefined();
  });

  it("shows full breakdown when both invoice and costs exist", async () => {
    const mod = await import("@/app/jobs/[id]/job-pnl");
    const { JobPnL } = mod;

    const data = {
      invoicedNet: 50000, // £500.00
      costsNet: 4000, // £40.00
      grossProfit: 46000, // £460.00
      marginPct: 92,
      unpaidCosts: 0,
      hasInvoice: true,
    };

    render(<JobPnL data={data} contractorVatRegistered={false} />);

    // Full breakdown must appear
    expect(screen.getByText(/invoiced.*net/i)).toBeDefined();
    expect(screen.getByText(/costs.*net/i)).toBeDefined();
    expect(screen.getByText(/gross profit/i)).toBeDefined();

    // All three figures must be visible
    expect(screen.getByText(/£500\.00/)).toBeDefined();
    expect(screen.getByText(/£40\.00/)).toBeDefined();
    expect(screen.getByText(/£460\.00/)).toBeDefined();

    // The margin percentage must be visible
    expect(screen.getByText(/92\.0%/)).toBeDefined();

    // The footnote must still appear
    expect(
      screen.getByText(/estimate only.*not tax advice/i)
    ).toBeDefined();
  });

  it("still handles null data with error message", async () => {
    const mod = await import("@/app/jobs/[id]/job-pnl");
    const { JobPnL } = mod;

    render(<JobPnL data={null} contractorVatRegistered={false} />);

    // Error state must appear
    expect(screen.getByText(/unable to load.*p&l data/i)).toBeDefined();
  });

  it("empty state points at adding costs", async () => {
    const mod = await import("@/app/jobs/[id]/job-pnl");
    const { JobPnL } = mod;

    const data = {
      invoicedNet: 0,
      costsNet: 0,
      grossProfit: 0,
      marginPct: null,
      unpaidCosts: 0,
      hasInvoice: false,
    };

    render(<JobPnL data={data} contractorVatRegistered={false} />);

    // The message must mention adding costs
    const message = screen.getByText(/add.*cost/i);
    expect(message).toBeDefined();
  });
});
