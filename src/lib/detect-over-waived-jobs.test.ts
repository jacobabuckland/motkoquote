import { describe, expect, it } from "vitest";
import { detectOverWaivedJobs } from "./detect-over-waived-jobs";

describe("detectOverWaivedJobs", () => {
  it("returns empty result when no events exist", () => {
    const result = detectOverWaivedJobs([]);

    expect(result.overWaivedJobs).toHaveLength(0);
    expect(result.ambiguousJobs).toHaveLength(0);
    expect(result.earliestReliableTimestamp).toBeNull();
  });

  it("detects no over-waives when balance is always positive", () => {
    const events = [
      {
        contractor_id: "c1",
        delta: 5,
        reason: "signup_grant",
        related_job_id: null,
        created_at: "2026-01-01T10:00:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job1",
        created_at: "2026-01-01T10:05:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job2",
        created_at: "2026-01-01T10:05:01Z",
      },
    ];

    const result = detectOverWaivedJobs(events);

    expect(result.overWaivedJobs).toHaveLength(0);
    expect(result.earliestReliableTimestamp).toBe("2026-01-01T10:00:00Z");
  });

  it("detects job consumed when balance was zero", () => {
    const events = [
      {
        contractor_id: "c1",
        delta: 1,
        reason: "signup_grant",
        related_job_id: null,
        created_at: "2026-01-01T10:00:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job1",
        created_at: "2026-01-01T11:00:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job2",
        created_at: "2026-01-01T11:00:01Z",
      },
    ];

    const result = detectOverWaivedJobs(events);

    expect(result.overWaivedJobs).toHaveLength(1);
    expect(result.overWaivedJobs[0].jobId).toBe("job2");
    expect(result.overWaivedJobs[0].balanceAtConsumption).toBe(0);
    expect(result.overWaivedJobs[0].timestamp).toBe("2026-01-01T11:00:01Z");
  });

  it("detects multiple jobs consumed when balance was negative", () => {
    const events = [
      {
        contractor_id: "c1",
        delta: 1,
        reason: "signup_grant",
        related_job_id: null,
        created_at: "2026-01-01T10:00:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job1",
        created_at: "2026-01-01T11:00:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job2",
        created_at: "2026-01-01T11:00:01Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job3",
        created_at: "2026-01-01T11:00:02Z",
      },
    ];

    const result = detectOverWaivedJobs(events);

    expect(result.overWaivedJobs).toHaveLength(2);
    expect(result.overWaivedJobs[0].jobId).toBe("job2");
    expect(result.overWaivedJobs[0].balanceAtConsumption).toBe(0);
    expect(result.overWaivedJobs[1].jobId).toBe("job3");
    expect(result.overWaivedJobs[1].balanceAtConsumption).toBe(-1);
  });

  it("sorts events by created_at before replaying", () => {
    const events = [
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job2",
        created_at: "2026-01-01T11:00:01Z",
      },
      {
        contractor_id: "c1",
        delta: 1,
        reason: "signup_grant",
        related_job_id: null,
        created_at: "2026-01-01T10:00:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job1",
        created_at: "2026-01-01T11:00:00Z",
      },
    ];

    const result = detectOverWaivedJobs(events);

    expect(result.overWaivedJobs).toHaveLength(1);
    expect(result.overWaivedJobs[0].jobId).toBe("job2");
    expect(result.earliestReliableTimestamp).toBe("2026-01-01T10:00:00Z");
  });

  it("flags jobs with identical timestamps as ambiguous", () => {
    const events = [
      {
        contractor_id: "c1",
        delta: 1,
        reason: "signup_grant",
        related_job_id: null,
        created_at: "2026-01-01T10:00:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job1",
        created_at: "2026-01-01T11:00:00.000Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job2",
        created_at: "2026-01-01T11:00:00.000Z",
      },
    ];

    const result = detectOverWaivedJobs(events);

    expect(result.ambiguousJobs).toContain("job1");
    expect(result.ambiguousJobs).toContain("job2");

    const overWaivedJobIds = result.overWaivedJobs.map((j) => j.jobId);
    expect(overWaivedJobIds).not.toContain("job1");
    expect(overWaivedJobIds).not.toContain("job2");
  });

  it("ignores non-job_consumed events when detecting over-waives", () => {
    const events = [
      {
        contractor_id: "c1",
        delta: 1,
        reason: "signup_grant",
        related_job_id: null,
        created_at: "2026-01-01T10:00:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job1",
        created_at: "2026-01-01T11:00:00Z",
      },
      {
        contractor_id: "c1",
        delta: 2,
        reason: "admin_grant",
        related_job_id: null,
        created_at: "2026-01-01T11:00:01Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job2",
        created_at: "2026-01-01T11:00:02Z",
      },
    ];

    const result = detectOverWaivedJobs(events);

    // job1: balance before = 1, after = 0 (valid)
    // admin_grant: balance before = 0, after = 2
    // job2: balance before = 2, after = 1 (valid)
    expect(result.overWaivedJobs).toHaveLength(0);
  });

  it("correctly tracks balance across mixed event types", () => {
    const events = [
      {
        contractor_id: "c1",
        delta: 2,
        reason: "signup_grant",
        related_job_id: null,
        created_at: "2026-01-01T10:00:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job1",
        created_at: "2026-01-01T10:01:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job2",
        created_at: "2026-01-01T10:02:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job3",
        created_at: "2026-01-01T10:03:00Z",
      },
      {
        contractor_id: "c1",
        delta: 3,
        reason: "referral_grant",
        related_job_id: null,
        created_at: "2026-01-01T10:04:00Z",
      },
      {
        contractor_id: "c1",
        delta: -1,
        reason: "job_consumed",
        related_job_id: "job4",
        created_at: "2026-01-01T10:05:00Z",
      },
    ];

    const result = detectOverWaivedJobs(events);

    // Balance progression: 0 → +2 → 1 → 0 → -1 (job3 invalid) → +2 → 1 (job4 valid)
    expect(result.overWaivedJobs).toHaveLength(1);
    expect(result.overWaivedJobs[0].jobId).toBe("job3");
    expect(result.overWaivedJobs[0].balanceAtConsumption).toBe(0);
  });
});
