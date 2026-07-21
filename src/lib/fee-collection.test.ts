import { describe, expect, it } from "vitest";
import {
  planFeeCollections,
  planDunningAction,
  DEFAULT_DUNNING_POLICY,
} from "./fee-collection";

describe("planFeeCollections", () => {
  it("rolls a trade's accrued jobs into one collection", () => {
    const plans = planFeeCollections([
      { jobId: "j1", contractorId: "a", feeAmountPennies: 200 },
      { jobId: "j2", contractorId: "a", feeAmountPennies: 400 },
    ]);
    expect(plans).toEqual([
      { contractorId: "a", jobIds: ["j1", "j2"], totalPennies: 600 },
    ]);
  });

  it("separates collections per contractor, ordered by id", () => {
    const plans = planFeeCollections([
      { jobId: "j3", contractorId: "b", feeAmountPennies: 200 },
      { jobId: "j1", contractorId: "a", feeAmountPennies: 200 },
      { jobId: "j2", contractorId: "a", feeAmountPennies: 200 },
    ]);
    expect(plans).toEqual([
      { contractorId: "a", jobIds: ["j1", "j2"], totalPennies: 400 },
      { contractorId: "b", jobIds: ["j3"], totalPennies: 200 },
    ]);
  });

  it("sorts job ids within a collection deterministically", () => {
    const plans = planFeeCollections([
      { jobId: "z", contractorId: "a", feeAmountPennies: 200 },
      { jobId: "a", contractorId: "a", feeAmountPennies: 200 },
      { jobId: "m", contractorId: "a", feeAmountPennies: 200 },
    ]);
    expect(plans[0]?.jobIds).toEqual(["a", "m", "z"]);
  });

  it("ignores non-positive fees and never bills a zero total", () => {
    const plans = planFeeCollections([
      { jobId: "j1", contractorId: "a", feeAmountPennies: 0 },
      { jobId: "j2", contractorId: "a", feeAmountPennies: -100 },
      { jobId: "j3", contractorId: "b", feeAmountPennies: 200 },
    ]);
    expect(plans).toEqual([
      { contractorId: "b", jobIds: ["j3"], totalPennies: 200 },
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
