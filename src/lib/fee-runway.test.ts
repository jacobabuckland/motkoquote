import { describe, expect, it } from "vitest";
import {
  computeFeeRunway,
  feeRunwayBannerCopy,
  PASSIVE_NUDGE_MAX_FREE_JOBS,
  type FeeRunway,
} from "@/lib/fee-runway";

const runwayAt = (freeJobsRemaining: number): FeeRunway =>
  computeFeeRunway({ freeJobsRemaining });

describe("computeFeeRunway — rungs", () => {
  it("is ok with plenty of runway (>2 free jobs)", () => {
    expect(runwayAt(3).state).toBe("ok");
    expect(runwayAt(5).state).toBe("ok");
  });

  it("nudges passively at 2 and 1 free jobs left", () => {
    for (const free of [PASSIVE_NUDGE_MAX_FREE_JOBS, 1]) {
      expect(runwayAt(free).state).toBe("passive_nudge");
    }
  });

  it("reports the allowance spent at zero", () => {
    expect(runwayAt(0).state).toBe("allowance_spent");
  });

  it("returns to ok when referral or founding credits lift the balance", () => {
    // A trade at 0 who unlocks +5 from a referral is back to plenty of runway.
    expect(runwayAt(5).state).toBe("ok");
    expect(runwayAt(3).state).toBe("ok");
  });
});

// The whole point of the rewrite: PAY-5 removed the mandate rail that was the
// only way out of the old 'blocked' rung, so a spent allowance could strand a
// trade with no route back. Nothing here may gate an action ever again.
describe("computeFeeRunway — nothing blocks", () => {
  it("exposes no blocking signal on any rung", () => {
    for (const free of [10, 3, 2, 1, 0]) {
      const runway = runwayAt(free);
      expect(runway).not.toHaveProperty("canSendQuote");
      expect(runway).not.toHaveProperty("mandateAuthorized");
      expect(Object.values(runway)).not.toContain("blocked");
    }
  });

  it("has no state that reads as a stop", () => {
    const states = [10, 3, 2, 1, 0].map((free) => runwayAt(free).state);
    expect(states).not.toContain("blocked");
    expect(states).not.toContain("grace");
  });
});

describe("feeRunwayBannerCopy — renders nothing when it should", () => {
  it("returns null when the runway is clear (ok)", () => {
    expect(feeRunwayBannerCopy(runwayAt(5))).toBeNull();
    expect(feeRunwayBannerCopy(runwayAt(3))).toBeNull();
  });
});

describe("feeRunwayBannerCopy — pricing wording per rung", () => {
  it("passive nudge states the allowance, the per-job fee, and both bands", () => {
    const copy = feeRunwayBannerCopy(runwayAt(2));
    expect(copy?.tone).toBe("warning");
    expect(copy?.body).toContain("2 free jobs left");
    expect(copy?.body).toContain("first 5 paid jobs");
    expect(copy?.body).toContain("£2 per paid job");
    expect(copy?.body).toContain("£4 over £1,000");
    expect(copy?.ctaHref).toBe("/settings");
  });

  it("singularises 'job' at exactly one free job left", () => {
    expect(feeRunwayBannerCopy(runwayAt(1))?.body).toContain("1 free job left");
  });

  it("allowance spent states the fee and that nothing is blocked", () => {
    const copy = feeRunwayBannerCopy(runwayAt(0));
    expect(copy?.tone).toBe("warning");
    expect(copy?.body).toContain("£2 per paid job");
    expect(copy?.body).toContain("nothing stops you quoting");
  });

  it("never pauses quoting or points at a billing setup that no longer exists", () => {
    for (const free of [2, 1, 0]) {
      const copy = feeRunwayBannerCopy(runwayAt(free));
      expect(copy?.body).not.toContain("paused");
      expect(copy?.body).not.toContain("Set up");
      expect(copy?.ctaLabel).not.toContain("Set up fee billing");
      expect(copy?.tone).not.toBe("error");
    }
  });

  // The fee is flat and capped. Percentage language would misdescribe it.
  it("never describes the fee as a percentage, commission or cut", () => {
    for (const free of [2, 1, 0]) {
      const body = feeRunwayBannerCopy(runwayAt(free))?.body ?? "";
      expect(body).not.toContain("%");
      expect(body).not.toContain("commission");
      expect(body).not.toContain("cut");
    }
  });
});
