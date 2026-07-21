import { describe, expect, it } from "vitest";
import { computeFreeJobsCorrections } from "./reconcile-free-jobs";

describe("computeFreeJobsCorrections", () => {
  it("returns no corrections when every cache matches the ledger sum", () => {
    const events = [
      { contractor_id: "a", delta: 5 },
      { contractor_id: "a", delta: -1 },
      { contractor_id: "b", delta: 5 },
    ];
    const contractors = [
      { id: "a", free_jobs_remaining: 4 },
      { id: "b", free_jobs_remaining: 5 },
    ];
    expect(computeFreeJobsCorrections(events, contractors)).toEqual([]);
  });

  it("corrects a cache that drifted from the ledger", () => {
    const events = [
      { contractor_id: "a", delta: 5 },
      { contractor_id: "a", delta: -1 },
      { contractor_id: "a", delta: -1 },
    ];
    const contractors = [{ id: "a", free_jobs_remaining: 4 }];
    expect(computeFreeJobsCorrections(events, contractors)).toEqual([
      { contractorId: "a", from: 4, to: 3 },
    ]);
  });

  it("reconciles a contractor with no ledger rows to zero", () => {
    const contractors = [{ id: "a", free_jobs_remaining: 5 }];
    expect(computeFreeJobsCorrections([], contractors)).toEqual([
      { contractorId: "a", from: 5, to: 0 },
    ]);
  });

  it("sums referral unlocks alongside consumption", () => {
    const events = [
      { contractor_id: "a", delta: 5 },
      { contractor_id: "a", delta: -1 },
      { contractor_id: "a", delta: 5 },
    ];
    const contractors = [{ id: "a", free_jobs_remaining: 4 }];
    expect(computeFreeJobsCorrections(events, contractors)).toEqual([
      { contractorId: "a", from: 4, to: 9 },
    ]);
  });
});
