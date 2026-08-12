/**
 * Issue #188: Pure detection logic for over-waived jobs.
 *
 * When two jobs settled concurrently against a single remaining free credit,
 * both were waived and both consumed the credit. This detects jobs that were
 * waived when the running balance was already ≤0 by replaying the credit_events
 * timeline.
 */

export type CreditEvent = {
  contractor_id: string;
  delta: number;
  reason: string;
  related_job_id: string | null;
  created_at: string;
};

export type OverWaivedJob = {
  jobId: string;
  balanceAtConsumption: number;
  timestamp: string;
};

export type DetectionResult = {
  overWaivedJobs: OverWaivedJob[];
  ambiguousJobs: string[];
  earliestReliableTimestamp: string | null;
};

/**
 * Detects jobs that consumed a free credit when the balance was already ≤0.
 *
 * Accepts a contractor's credit_events ordered by created_at, reconstructs the
 * running balance over time, and identifies job_consumed events that fired when
 * the balance was ≤0 (invalid waives).
 *
 * Edge cases:
 * - Two events with identical created_at: flagged as ambiguous, excluded from
 *   auto-correction (sequence cannot be reconstructed reliably).
 * - No events: returns empty overWaivedJobs and null earliestReliableTimestamp.
 */
export const detectOverWaivedJobs = (events: CreditEvent[] | unknown[]): DetectionResult => {
  const typedEvents = events as CreditEvent[];

  if (typedEvents.length === 0) {
    return {
      overWaivedJobs: [],
      ambiguousJobs: [],
      earliestReliableTimestamp: null,
    };
  }

  // Sort events by created_at to ensure correct sequence
  const sorted = [...typedEvents].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );

  // Detect events with identical timestamps (ambiguous ordering)
  const timestampGroups = new Map<string, CreditEvent[]>();
  for (const event of sorted) {
    const group = timestampGroups.get(event.created_at) ?? [];
    group.push(event);
    timestampGroups.set(event.created_at, group);
  }

  const ambiguousJobs: string[] = [];
  for (const group of timestampGroups.values()) {
    if (group.length > 1) {
      // Multiple events with the same timestamp - cannot determine order
      for (const event of group) {
        if (event.reason === "job_consumed" && event.related_job_id) {
          ambiguousJobs.push(event.related_job_id);
        }
      }
    }
  }

  // Replay timeline to detect over-waives
  let runningBalance = 0;
  const overWaivedJobs: OverWaivedJob[] = [];

  for (const event of sorted) {
    if (event.reason === "job_consumed" && event.related_job_id) {
      // Check if this job consumed a credit when balance was ≤0
      if (runningBalance <= 0 && !ambiguousJobs.includes(event.related_job_id)) {
        overWaivedJobs.push({
          jobId: event.related_job_id,
          balanceAtConsumption: runningBalance,
          timestamp: event.created_at,
        });
      }
    }

    // Apply the delta to the running balance
    runningBalance += event.delta;
  }

  const earliestReliableTimestamp = sorted[0].created_at;

  return {
    overWaivedJobs,
    ambiguousJobs,
    earliestReliableTimestamp,
  };
};
