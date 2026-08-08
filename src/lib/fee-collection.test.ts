import { describe, expect, it } from "vitest";
import {
  planFeeCollections,
  planDunningAction,
  DEFAULT_DUNNING_POLICY,
  type AccruedJob,
} from "./fee-collection";

// £2 gross splits to net £1.67 + VAT £0.33; £4 to net £3.33 + VAT £0.67.
const std: Pick<AccruedJob, "feeAmountPennies" | "netPennies" | "vatPennies"> = {
  feeAmountPennies: 200,
  netPennies: 167,
  vatPennies: 33,
};
const large: Pick<AccruedJob, "feeAmountPennies" | "netPennies" | "vatPennies"> = {
  feeAmountPennies: 400,
  netPennies: 333,
  vatPennies: 67,
};

describe("planFeeCollections", () => {
  it("rolls a trade's accrued jobs into one collection, summing the VAT split", () => {
    const plans = planFeeCollections([
      { jobId: "j1", contractorId: "a", ...std },
      { jobId: "j2", contractorId: "a", ...large },
    ]);
    expect(plans).toEqual([
      {
        contractorId: "a",
        jobIds: ["j1", "j2"],
        totalPennies: 600,
        netPennies: 500,
        vatPennies: 100,
      },
    ]);
    // The summed split still equals the gross charged — never inflated.
    expect(plans[0]!.netPennies + plans[0]!.vatPennies).toBe(plans[0]!.totalPennies);
  });

  it("separates collections per contractor, ordered by id", () => {
    const plans = planFeeCollections([
      { jobId: "j3", contractorId: "b", ...std },
      { jobId: "j1", contractorId: "a", ...std },
      { jobId: "j2", contractorId: "a", ...std },
    ]);
    expect(plans).toEqual([
      {
        contractorId: "a",
        jobIds: ["j1", "j2"],
        totalPennies: 400,
        netPennies: 334,
        vatPennies: 66,
      },
      {
        contractorId: "b",
        jobIds: ["j3"],
        totalPennies: 200,
        netPennies: 167,
        vatPennies: 33,
      },
    ]);
  });

  it("sorts job ids within a collection deterministically", () => {
    const plans = planFeeCollections([
      { jobId: "z", contractorId: "a", ...std },
      { jobId: "a", contractorId: "a", ...std },
      { jobId: "m", contractorId: "a", ...std },
    ]);
    expect(plans[0]?.jobIds).toEqual(["a", "m", "z"]);
  });

  it("ignores non-positive fees and never bills a zero total", () => {
    const plans = planFeeCollections([
      { jobId: "j1", contractorId: "a", feeAmountPennies: 0, netPennies: 0, vatPennies: 0 },
      { jobId: "j2", contractorId: "a", feeAmountPennies: -100, netPennies: -84, vatPennies: -16 },
      { jobId: "j3", contractorId: "b", ...std },
    ]);
    expect(plans).toEqual([
      {
        contractorId: "b",
        jobIds: ["j3"],
        totalPennies: 200,
        netPennies: 167,
        vatPennies: 33,
      },
    ]);
  });

  it("returns nothing when there are no accrued jobs", () => {
    expect(planFeeCollections([])).toEqual([]);
  });
});

describe("planDunningAction", () => {
  const now = new Date("2026-07-21T00:00:00.000Z");

  it("retries once the interval has elapsed", () => {
    expect(
      planDunningAction(
        { attempts: 1, lastAttemptAt: "2026-07-17T00:00:00.000Z" },
        now,
      ),
    ).toEqual({ action: "retry", contractorStatus: "past_due" });
  });

  it("waits when too little time has passed since the last attempt", () => {
    expect(
      planDunningAction(
        { attempts: 1, lastAttemptAt: "2026-07-20T00:00:00.000Z" },
        now,
      ),
    ).toEqual({ action: "wait", contractorStatus: "past_due" });
  });

  it("gives up and pauses once the retry budget is exhausted", () => {
    expect(
      planDunningAction(
        { attempts: DEFAULT_DUNNING_POLICY.maxAttempts, lastAttemptAt: "2026-07-01T00:00:00.000Z" },
        now,
      ),
    ).toEqual({ action: "give_up", contractorStatus: "paused" });
  });

  it("honours a custom policy", () => {
    expect(
      planDunningAction(
        { attempts: 2, lastAttemptAt: "2026-07-20T00:00:00.000Z" },
        now,
        { maxAttempts: 2, retryIntervalDays: 1 },
      ),
    ).toEqual({ action: "give_up", contractorStatus: "paused" });
  });
});
