/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { JobPnL } from "@/app/jobs/[id]/job-pnl";

afterEach(cleanup);

describe("Regression: #736 — genuine zero cost must not trigger empty state", () => {
  it("shows full breakdown for uninvoiced job with one £0.00 cost recorded", () => {
    // The defect: `isEmpty = !hasInvoice && costsNet === 0` treated "no costs
    // recorded" and "costs recorded that sum to zero" identically, because
    // costsNet is a sum, not a count. On an uninvoiced job, a recorded £0.00
    // cost was suppressed, which is exactly what the spec forbids.
    //
    // This case is reachable: createJobCostSchema allows zero and negative
    // amounts (no .positive(), no .min(1)), so two costs offsetting to zero
    // also land here.
    //
    // The fix: add costCount to the data shape, check `costCount === 0`
    // instead of `costsNet === 0`.

    const data = {
      invoicedNet: 0,
      costsNet: 0, // sum is zero
      grossProfit: 0,
      marginPct: null,
      unpaidCosts: 0,
      hasInvoice: false,
      costCount: 1, // but one cost WAS recorded
    };

    render(<JobPnL data={data} contractorVatRegistered={false} />);

    // Must show the full three-row breakdown, not the empty state
    expect(screen.getByText(/invoiced.*net/i)).toBeDefined();
    expect(screen.getByText(/costs.*net/i)).toBeDefined();
    expect(screen.getByText(/gross profit/i)).toBeDefined();

    // The £0.00 cost is a genuine result
    expect(screen.getByText(/£0\.00/)).toBeDefined();

    // Must NOT show the empty state message
    expect(screen.queryByText(/nothing.*invoiced.*no costs.*recorded/i)).toBeNull();
  });
});
