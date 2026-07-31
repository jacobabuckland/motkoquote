import { describe, expect, it } from "vitest";
import {
  computeFeeRunway,
  feeRunwayBannerCopy,
  GRACE_PAID_JOBS,
  type FeeRunwayInput,
} from "@/lib/fee-runway";

const input = (over: Partial<FeeRunwayInput> = {}): FeeRunwayInput => ({
  feeBillingEnabled: true,
  freeJobsRemaining: 5,
  mandateAuthorized: false,
  paidJobsSinceAllowanceZero: 0,
  accruedFeePennies: 0,
  ...over,
});

describe("computeFeeRunway — flag off renders nothing", () => {
  it("is inactive and never blocks while fee billing is off, whatever the state", () => {
    const spent = computeFeeRunway(
      input({
        feeBillingEnabled: false,
        freeJobsRemaining: 0,
        paidJobsSinceAllowanceZero: 99,
        accruedFeePennies: 5000,
      }),
    );
    expect(spent.state).toBe("inactive");
    expect(spent.canSendQuote).toBe(true);
  });

  it("stays inactive even with 1–2 free jobs (no passive nudge while dark)", () => {
    expect(computeFeeRunway(input({ feeBillingEnabled: false, freeJobsRemaining: 1 })).state).toBe(
      "inactive",
    );
  });
});

describe("computeFeeRunway — passive nudge rung", () => {
  it("is ok with plenty of runway (>2 free jobs)", () => {
    expect(computeFeeRunway(input({ freeJobsRemaining: 3 })).state).toBe("ok");
    expect(computeFeeRunway(input({ freeJobsRemaining: 5 })).state).toBe("ok");
  });

  it("nudges passively at 2 and 1 free jobs left — but never blocks", () => {
    for (const free of [2, 1]) {
      const runway = computeFeeRunway(input({ freeJobsRemaining: free }));
      expect(runway.state).toBe("passive_nudge");
      expect(runway.canSendQuote).toBe(true);
    }
  });
});

describe("computeFeeRunway — grace window then block", () => {
  it("opens the grace window when the allowance hits zero with no mandate", () => {
    const runway = computeFeeRunway(
      input({ freeJobsRemaining: 0, paidJobsSinceAllowanceZero: 0, accruedFeePennies: 200 }),
    );
    expect(runway.state).toBe("grace");
    expect(runway.gracePaidJobsRemaining).toBe(GRACE_PAID_JOBS);
    expect(runway.canSendQuote).toBe(true);
    expect(runway.accruedFeePennies).toBe(200);
  });

  it("counts down the grace window as paid jobs accrue", () => {
    const runway = computeFeeRunway(
      input({ freeJobsRemaining: 0, paidJobsSinceAllowanceZero: 2 }),
    );
    expect(runway.state).toBe("grace");
    expect(runway.gracePaidJobsRemaining).toBe(1);
  });

  it("blocks new sends once the grace window is spent", () => {
    const runway = computeFeeRunway(
      input({ freeJobsRemaining: 0, paidJobsSinceAllowanceZero: GRACE_PAID_JOBS }),
    );
    expect(runway.state).toBe("blocked");
    expect(runway.gracePaidJobsRemaining).toBe(0);
    expect(runway.canSendQuote).toBe(false);
  });

  it("stays blocked well past the grace window", () => {
    const runway = computeFeeRunway(
      input({ freeJobsRemaining: 0, paidJobsSinceAllowanceZero: 10 }),
    );
    expect(runway.state).toBe("blocked");
    expect(runway.canSendQuote).toBe(false);
  });
});

describe("computeFeeRunway — an authorised mandate clears the ladder", () => {
  it("is ok and never blocks once billing is set up, even at zero free jobs", () => {
    const runway = computeFeeRunway(
      input({
        mandateAuthorized: true,
        freeJobsRemaining: 0,
        paidJobsSinceAllowanceZero: 20,
      }),
    );
    expect(runway.state).toBe("ok");
    expect(runway.canSendQuote).toBe(true);
  });
});

describe("computeFeeRunway — referral/founding credits extend runway", () => {
  it("returns to ok when extra free-job credits lift the balance above the nudge line", () => {
    // A trade at 0 who unlocks +5 from a referral is back to plenty of runway.
    expect(computeFeeRunway(input({ freeJobsRemaining: 5 })).state).toBe("ok");
    // One founding credit above the nudge line is enough to leave passive_nudge.
    expect(computeFeeRunway(input({ freeJobsRemaining: 3 })).state).toBe("ok");
  });
});

describe("feeRunwayBannerCopy — renders nothing when it should", () => {
  it("returns null while fee billing is off (banner draws nothing)", () => {
    const runway = computeFeeRunway(input({ feeBillingEnabled: false, freeJobsRemaining: 0 }));
    expect(feeRunwayBannerCopy(runway)).toBeNull();
  });

  it("returns null when the runway is clear (ok)", () => {
    expect(feeRunwayBannerCopy(computeFeeRunway(input({ freeJobsRemaining: 5 })))).toBeNull();
    expect(
      feeRunwayBannerCopy(computeFeeRunway(input({ mandateAuthorized: true, freeJobsRemaining: 0 }))),
    ).toBeNull();
  });
});

describe("feeRunwayBannerCopy — blessed pricing wording per rung", () => {
  it("passive nudge states the free allowance, per-job fee, and both bands", () => {
    const copy = feeRunwayBannerCopy(computeFeeRunway(input({ freeJobsRemaining: 2 })));
    expect(copy?.tone).toBe("warning");
    expect(copy?.body).toContain("2 free jobs left");
    expect(copy?.body).toContain("first 5 paid jobs");
    expect(copy?.body).toContain("£2 per paid job");
    expect(copy?.body).toContain("£4 over £1,000");
    expect(copy?.body).toContain("collected monthly by bank");
    expect(copy?.ctaHref).toBe("/settings");
  });

  it("singularises 'job' at exactly one free job left", () => {
    const copy = feeRunwayBannerCopy(computeFeeRunway(input({ freeJobsRemaining: 1 })));
    expect(copy?.body).toContain("1 free job left");
  });

  it("grace shows accrued fees and the remaining quote runway", () => {
    const copy = feeRunwayBannerCopy(
      computeFeeRunway(
        input({ freeJobsRemaining: 0, paidJobsSinceAllowanceZero: 1, accruedFeePennies: 400 }),
      ),
    );
    expect(copy?.tone).toBe("warning");
    expect(copy?.body).toContain("£4.00");
    expect(copy?.body).toContain(`${GRACE_PAID_JOBS - 1} more quotes`);
  });

  it("blocked is an error tone that still permits getting paid", () => {
    const copy = feeRunwayBannerCopy(
      computeFeeRunway(
        input({ freeJobsRemaining: 0, paidJobsSinceAllowanceZero: GRACE_PAID_JOBS }),
      ),
    );
    expect(copy?.tone).toBe("error");
    expect(copy?.body).toContain("New quotes are paused");
    expect(copy?.body).toContain("still get paid");
  });
});
