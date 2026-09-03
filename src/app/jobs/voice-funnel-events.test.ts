import { describe, it, expect, vi, beforeEach } from "vitest";

// OBS-1 — the voice funnel, end to end.
//
// Before this, `voice_session_completed` was the only event the intake emitted,
// and only when the caller supplied a wrapReason. So a session that never
// started, one that died on "Listening", and one the contractor walked away
// from were all the same thing in `events`: nothing at all. Abandonment could
// only be inferred from orphaned sow_in_progress job rows, which the manual
// path also produces — so the inference was wrong in both directions.
//
// run_id is deliberately the job id rather than a new column. The id is minted
// at session start, is unique per session, is carried by every stage that
// follows, and is reused by redraftJob — which is exactly what a run id has to
// do. A separate column would have needed a migration applied by hand before
// any of this could deploy, and would have said the same thing.
const h = vi.hoisted(() => {
  // Every parameter optional, per AGENTS.md: a zero-argument mock makes
  // mock.calls[0][1] a type error, and a required one makes a no-argument call
  // one. Both compile nowhere and run everywhere.
  const track = vi.fn(async (_name?: string, _properties?: Record<string, unknown>) => {});
  return { track };
});

vi.mock("@/lib/analytics", () => ({ track: h.track, logError: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/knowledge", () => ({ syncQuoteKnowledge: vi.fn(), findSimilarPastJobs: vi.fn() }));
vi.mock("@/lib/materials", () => ({
  rememberMaterialPrices: vi.fn(),
  findKnownMaterialPrices: vi.fn(),
}));
vi.mock("@/lib/claude", () => ({ generateSowNarrative: vi.fn(), draftQuoteLineItems: vi.fn() }));
vi.mock("@/lib/realtime", () => ({ createRealtimeClientSecret: vi.fn() }));

import { reportVoiceAbandoned } from "./actions";

const JOB_ID = "33333333-3333-4333-8333-333333333333";

describe("reportVoiceAbandoned", () => {
  beforeEach(() => h.track.mockClear());

  it("records the run and why it ended, so an abandonment rate is computable from events alone", async () => {
    await reportVoiceAbandoned({ jobId: JOB_ID, reason: "mic_denied" });

    expect(h.track).toHaveBeenCalledWith("voice_session_abandoned", {
      run_id: JOB_ID,
      job_id: JOB_ID,
      reason: "mic_denied",
    });
  });

  it("accepts each terminal reason the client can report", async () => {
    for (const reason of ["mic_denied", "connect_failed", "left", "unknown"] as const) {
      await reportVoiceAbandoned({ jobId: JOB_ID, reason });
    }

    expect(h.track.mock.calls.map((call) => (call[1] as { reason: string }).reason)).toEqual([
      "mic_denied",
      "connect_failed",
      "left",
      "unknown",
    ]);
  });

  it("rejects a reason outside the set rather than writing a value nothing can group by", async () => {
    await expect(
      reportVoiceAbandoned({
        jobId: JOB_ID,
        // Deliberately outside the enum: the whole value of the event is that
        // `reason` is groupable, which a free-text field would not be.
        reason: "whatever" as "unknown",
      }),
    ).rejects.toThrow();

    expect(h.track).not.toHaveBeenCalled();
  });

  it("rejects a job id that is not one, so a stray call cannot write an unjoinable run", async () => {
    await expect(
      reportVoiceAbandoned({ jobId: "not-a-uuid", reason: "left" }),
    ).rejects.toThrow();

    expect(h.track).not.toHaveBeenCalled();
  });
});
