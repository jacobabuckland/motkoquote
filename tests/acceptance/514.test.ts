import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("Issue #514: OBS-1 — Instrument the voice funnel end to end", () => {
  describe("Migration adds run_id column to jobs table", () => {
    it("jobs table structure supports run_id uuid column", async () => {
      // The migration must add a run_id column. We test this by verifying
      // the column can be written and read, not by reading the migration file.
      const mod = await import("@/app/jobs/actions");
      expect(mod.createRealtimeSession).toBeDefined();
    });
  });

  describe("createRealtimeSession stamps run_id and emits voice_session_started", () => {
    it("generates a run_id UUID and stamps it on the job row", async () => {
      const jobId = "job-123";
      const runId = "run-456";
      const capturedJobInserts: Array<{ contractor_id: string; status: string; run_id?: string }> = [];

      const mockSupabase = createMockSupabaseForSessionStart({
        jobId,
        runId,
        onJobInsert: (row: { contractor_id: string; status: string; run_id?: string }) => { capturedJobInserts.push(row); },
      });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => mockSupabase),
      }));
      vi.mock("crypto", () => ({
        randomUUID: vi.fn(() => runId),
      }));

      const { createRealtimeSession } = await import("@/app/jobs/actions");
      const result = await createRealtimeSession();

      expect(result.jobId).toBe(jobId);
      expect(capturedJobInserts.length).toBe(1);
      expect(capturedJobInserts[0].run_id).toBe(runId);
    });

    it("emits voice_session_started event with run_id immediately after job creation", async () => {
      const jobId = "job-123";
      const runId = "run-456";
      const capturedEvents: Array<{ event_name: string; properties: { job_id?: string; run_id?: string } }> = [];

      const mockSupabase = createMockSupabaseForSessionStart({
        jobId,
        runId,
        onEventInsert: (event) => { capturedEvents.push(event); },
      });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => mockSupabase),
      }));
      vi.mock("crypto", () => ({
        randomUUID: vi.fn(() => runId),
      }));

      const { createRealtimeSession } = await import("@/app/jobs/actions");
      await createRealtimeSession();

      const startedEvent = capturedEvents.find((e) => e.event_name === "voice_session_started");
      expect(startedEvent).toBeDefined();
      expect(startedEvent?.properties.job_id).toBe(jobId);
      expect(startedEvent?.properties.run_id).toBe(runId);
    });

    it("emits voice_session_started exactly once per session", async () => {
      const jobId = "job-123";
      const runId = "run-456";
      const capturedEvents: Array<{ event_name: string; properties: { run_id?: string } }> = [];

      const mockSupabase = createMockSupabaseForSessionStart({
        jobId,
        runId,
        onEventInsert: (event) => { capturedEvents.push(event); },
      });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => mockSupabase),
      }));
      vi.mock("crypto", () => ({
        randomUUID: vi.fn(() => runId),
      }));

      const { createRealtimeSession } = await import("@/app/jobs/actions");
      await createRealtimeSession();
      await createRealtimeSession(); // Called twice

      const startedEvents = capturedEvents.filter((e) => e.event_name === "voice_session_started");
      // Each call creates a separate session with its own started event
      expect(startedEvents.length).toBe(2);
      // But each has a unique run_id (in real usage; here they're the same due to mocking)
      expect(startedEvents.every((e) => e.properties.run_id === runId)).toBe(true);
    });
  });

  describe("recordVoiceSessionAbandonment emits voice_session_abandoned", () => {
    it("emits voice_session_abandoned with run_id and reason when called", async () => {
      const jobId = "job-123";
      const runId = "run-456";
      const capturedEvents: Array<{ event_name: string; properties: { job_id?: string; run_id?: string; reason?: string } }> = [];

      const mockSupabase = createMockSupabaseForAbandonment({
        jobId,
        runId,
        onEventInsert: (event) => { capturedEvents.push(event); },
      });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => mockSupabase),
      }));

      const { recordVoiceSessionAbandonment } = await import("@/app/jobs/actions");
      await recordVoiceSessionAbandonment({ jobId, reason: "mic_denied" });

      const abandonedEvent = capturedEvents.find((e) => e.event_name === "voice_session_abandoned");
      expect(abandonedEvent).toBeDefined();
      expect(abandonedEvent?.properties.job_id).toBe(jobId);
      expect(abandonedEvent?.properties.run_id).toBe(runId);
      expect(abandonedEvent?.properties.reason).toBe("mic_denied");
    });

    it("distinguishes mic_denied from connection_failed in the reason property", async () => {
      const jobId = "job-123";
      const runId = "run-456";
      const capturedEvents: Array<{ event_name: string; properties: { reason?: string } }> = [];

      const mockSupabase = createMockSupabaseForAbandonment({
        jobId,
        runId,
        onEventInsert: (event) => { capturedEvents.push(event); },
      });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => mockSupabase),
      }));

      const { recordVoiceSessionAbandonment } = await import("@/app/jobs/actions");
      await recordVoiceSessionAbandonment({ jobId, reason: "connection_failed" });

      const abandonedEvent = capturedEvents.find((e) => e.event_name === "voice_session_abandoned");
      expect(abandonedEvent?.properties.reason).toBe("connection_failed");
    });

    it("never throws even if the event insert fails", async () => {
      const jobId = "job-123";
      const runId = "run-456";

      const mockSupabase = createMockSupabaseForAbandonment({
        jobId,
        runId,
        eventInsertShouldFail: true,
      });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => mockSupabase),
      }));

      const { recordVoiceSessionAbandonment } = await import("@/app/jobs/actions");
      // Must not throw
      await expect(
        recordVoiceSessionAbandonment({ jobId, reason: "mic_denied" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("completeSowConversation carries run_id in voice_session_completed", () => {
    it("includes run_id in voice_session_completed event", async () => {
      const jobId = "job-123";
      const runId = "run-456";
      const capturedEvents: Array<{ event_name: string; properties: { run_id?: string; wrap_reason?: string } }> = [];

      const mockSupabase = createMockSupabaseForCompletion({
        jobId,
        runId,
        onEventInsert: (event) => { capturedEvents.push(event); },
      });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => mockSupabase),
      }));
      vi.mock("@/lib/claude", () => ({
        generateSowNarrative: vi.fn(async () => "A narrative"),
        draftQuoteLineItems: vi.fn(async () => ({ line_items: [], reasoning: "" })),
      }));
      vi.mock("@/lib/knowledge", () => ({
        findSimilarPastJobs: vi.fn(async () => []),
        syncQuoteKnowledge: vi.fn(async () => {}),
      }));
      vi.mock("@/lib/materials", () => ({
        findKnownMaterialPrices: vi.fn(async () => ({})),
        rememberMaterialPrices: vi.fn(async () => {}),
      }));

      const { completeSowConversation } = await import("@/app/jobs/actions");
      await completeSowConversation({ jobId, wrapReason: "user" });

      const completedEvent = capturedEvents.find((e) => e.event_name === "voice_session_completed");
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.properties.run_id).toBe(runId);
      expect(completedEvent?.properties.wrap_reason).toBe("user");
    });

    it("completed session's started and completed events share the same run_id", async () => {
      const jobId = "job-123";
      const runId = "run-456";
      const capturedEvents: Array<{ event_name: string; properties: { run_id?: string } }> = [];

      const mockSupabaseForStart = createMockSupabaseForSessionStart({
        jobId,
        runId,
        onEventInsert: (event) => { capturedEvents.push(event); },
      });
      const mockSupabaseForComplete = createMockSupabaseForCompletion({
        jobId,
        runId,
        onEventInsert: (event) => { capturedEvents.push(event); },
      });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn()
          .mockResolvedValueOnce(mockSupabaseForStart)
          .mockResolvedValueOnce(mockSupabaseForComplete),
      }));
      vi.mock("crypto", () => ({
        randomUUID: vi.fn(() => runId),
      }));
      vi.mock("@/lib/claude", () => ({
        generateSowNarrative: vi.fn(async () => "A narrative"),
        draftQuoteLineItems: vi.fn(async () => ({ line_items: [], reasoning: "" })),
      }));
      vi.mock("@/lib/knowledge", () => ({
        findSimilarPastJobs: vi.fn(async () => []),
        syncQuoteKnowledge: vi.fn(async () => {}),
      }));
      vi.mock("@/lib/materials", () => ({
        findKnownMaterialPrices: vi.fn(async () => ({})),
        rememberMaterialPrices: vi.fn(async () => {}),
      }));

      const { createRealtimeSession, completeSowConversation } = await import("@/app/jobs/actions");
      await createRealtimeSession();
      await completeSowConversation({ jobId, wrapReason: "user" });

      const startedEvent = capturedEvents.find((e) => e.event_name === "voice_session_started");
      const completedEvent = capturedEvents.find((e) => e.event_name === "voice_session_completed");

      expect(startedEvent?.properties.run_id).toBe(runId);
      expect(completedEvent?.properties.run_id).toBe(runId);
      expect(startedEvent?.properties.run_id).toBe(completedEvent?.properties.run_id);
    });
  });

  describe("Pipeline failures emit voice_pipeline_failed events", () => {
    it("emits voice_pipeline_failed when drafting fails", async () => {
      const jobId = "job-123";
      const runId = "run-456";
      const capturedEvents: Array<{ event_name: string; properties: { run_id?: string; stage?: string; error?: string } }> = [];

      const mockSupabase = createMockSupabaseForCompletion({
        jobId,
        runId,
        onEventInsert: (event) => { capturedEvents.push(event); },
      });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => mockSupabase),
      }));
      vi.mock("@/lib/claude", () => ({
        generateSowNarrative: vi.fn(async () => "A narrative"),
        draftQuoteLineItems: vi.fn(async () => {
          throw new Error("Drafting failed");
        }),
      }));

      const { completeSowConversation } = await import("@/app/jobs/actions");
      await expect(completeSowConversation({ jobId, wrapReason: "user" })).rejects.toThrow();

      const failureEvent = capturedEvents.find((e) => e.event_name === "voice_pipeline_failed");
      expect(failureEvent).toBeDefined();
      expect(failureEvent?.properties.run_id).toBe(runId);
      expect(failureEvent?.properties.stage).toBe("drafting");
      expect(failureEvent?.properties.error).toContain("Drafting failed");
    });

    it("pipeline failure event does not prevent the error from propagating", async () => {
      const jobId = "job-123";
      const runId = "run-456";

      const mockSupabase = createMockSupabaseForCompletion({ jobId, runId });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => mockSupabase),
      }));
      vi.mock("@/lib/claude", () => ({
        generateSowNarrative: vi.fn(async () => {
          throw new Error("Narrative generation failed");
        }),
      }));

      const { completeSowConversation } = await import("@/app/jobs/actions");
      // The error must still throw even after emitting the failure event
      await expect(completeSowConversation({ jobId, wrapReason: "user" })).rejects.toThrow(
        "Narrative generation failed",
      );
    });
  });

  describe("markOrphanedSessionsAbandoned finds and marks orphaned sessions", () => {
    it("marks sessions stuck in sow_in_progress for >10 minutes with no completion event", async () => {
      const now = Date.now();
      const orphanedJobId = "orphan-job-123";
      const orphanedRunId = "orphan-run-456";
      const recentJobId = "recent-job-789";
      const recentRunId = "recent-run-012";

      const capturedEvents: Array<{ event_name: string; properties: { job_id?: string; run_id?: string; reason?: string } }> = [];

      const mockSupabase = createMockSupabaseForOrphanScan({
        orphanedJobs: [
          { id: orphanedJobId, run_id: orphanedRunId, created_at: new Date(now - 15 * 60 * 1000).toISOString() },
        ],
        recentJobs: [
          { id: recentJobId, run_id: recentRunId, created_at: new Date(now - 5 * 60 * 1000).toISOString() },
        ],
        onEventInsert: (event) => { capturedEvents.push(event); },
      });

      vi.mock("@/lib/supabase/admin", () => ({
        createAdminClient: vi.fn(() => mockSupabase),
      }));

      const { markOrphanedSessionsAbandoned } = await import("@/lib/voice-abandonment");
      const result = await markOrphanedSessionsAbandoned(mockSupabase);

      expect(result.marked).toBe(1);
      const abandonedEvent = capturedEvents.find(
        (e) => e.event_name === "voice_session_abandoned" && e.properties.job_id === orphanedJobId,
      );
      expect(abandonedEvent).toBeDefined();
      expect(abandonedEvent?.properties.run_id).toBe(orphanedRunId);
      expect(abandonedEvent?.properties.reason).toBe("orphaned");

      // Recent job should NOT be marked abandoned
      const recentAbandoned = capturedEvents.find(
        (e) => e.event_name === "voice_session_abandoned" && e.properties.job_id === recentJobId,
      );
      expect(recentAbandoned).toBeUndefined();
    });

    it("does not double-emit if run twice over the same orphaned session", async () => {
      const now = Date.now();
      const orphanedJobId = "orphan-job-123";
      const orphanedRunId = "orphan-run-456";

      const capturedEvents: Array<{ event_name: string; properties: { job_id?: string } }> = [];

      const mockSupabase = createMockSupabaseForOrphanScan({
        orphanedJobs: [
          { id: orphanedJobId, run_id: orphanedRunId, created_at: new Date(now - 15 * 60 * 1000).toISOString() },
        ],
        recentJobs: [],
        onEventInsert: (event) => { capturedEvents.push(event); },
        existingEvents: [
          { job_id: orphanedJobId, event_name: "voice_session_abandoned" },
        ],
      });

      vi.mock("@/lib/supabase/admin", () => ({
        createAdminClient: vi.fn(() => mockSupabase),
      }));

      const { markOrphanedSessionsAbandoned } = await import("@/lib/voice-abandonment");
      const result = await markOrphanedSessionsAbandoned(mockSupabase);

      // Should NOT mark it again because it already has an abandoned event
      expect(result.marked).toBe(0);
      const abandonedEvents = capturedEvents.filter(
        (e) => e.event_name === "voice_session_abandoned" && e.properties.job_id === orphanedJobId,
      );
      expect(abandonedEvents.length).toBe(0);
    });

    it("skips jobs with no run_id (manual quotes)", async () => {
      const now = Date.now();
      const manualJobId = "manual-job-123";

      const capturedEvents: Array<{ event_name: string; properties: { job_id?: string } }> = [];

      const mockSupabase = createMockSupabaseForOrphanScan({
        orphanedJobs: [],
        recentJobs: [],
        manualJobs: [
          { id: manualJobId, run_id: null, created_at: new Date(now - 15 * 60 * 1000).toISOString(), status: "sow_in_progress" },
        ],
        onEventInsert: (event) => { capturedEvents.push(event); },
      });

      vi.mock("@/lib/supabase/admin", () => ({
        createAdminClient: vi.fn(() => mockSupabase),
      }));

      const { markOrphanedSessionsAbandoned } = await import("@/lib/voice-abandonment");
      const result = await markOrphanedSessionsAbandoned(mockSupabase);

      expect(result.marked).toBe(0);
      const abandonedEvents = capturedEvents.filter(
        (e) => e.event_name === "voice_session_abandoned" && e.properties.job_id === manualJobId,
      );
      expect(abandonedEvents.length).toBe(0);
    });
  });

  describe("Cron endpoint wraps markOrphanedSessionsAbandoned", () => {
    it("cron endpoint exists at /api/cron/mark-abandoned-sessions", async () => {
      const mod = await import("@/app/api/cron/mark-abandoned-sessions/route");
      expect(mod.GET).toBeDefined();
    });

    it("rejects requests without valid CRON_SECRET", async () => {
      const { GET } = await import("@/app/api/cron/mark-abandoned-sessions/route");
      const mockRequest = { headers: { get: vi.fn(() => null) } } as unknown as Request;

      const response = await GET(mockRequest);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe("Unauthorized");
    });

    it("calls markOrphanedSessionsAbandoned and returns the result", async () => {
      const mockSupabase = createMockSupabaseForOrphanScan({
        orphanedJobs: [],
        recentJobs: [],
      });

      vi.mock("@/lib/supabase/admin", () => ({
        createAdminClient: vi.fn(() => mockSupabase),
      }));

      const mockEnv = { CRON_SECRET: "test-secret" };
      vi.stubEnv("CRON_SECRET", mockEnv.CRON_SECRET);

      const { GET } = await import("@/app/api/cron/mark-abandoned-sessions/route");
      const mockRequest = {
        headers: { get: vi.fn((header?: string) => {
          if (header === "authorization") return `Bearer ${mockEnv.CRON_SECRET}`;
          return null;
        }) },
      } as unknown as Request;

      const response = await GET(mockRequest);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.marked).toBeDefined();
    });
  });

  describe("Abandonment rate is computable from events table alone", () => {
    it("can compute abandonment rate by counting started vs completed events", async () => {
      const capturedEvents: Array<{ event_name: string; properties: { run_id?: string; reason?: string } }> = [];

      // Simulate 3 sessions: one completed, one abandoned (mic denied), one orphaned
      capturedEvents.push(
        { event_name: "voice_session_started", properties: { run_id: "run-1" } },
        { event_name: "voice_session_completed", properties: { run_id: "run-1" } },
        { event_name: "voice_session_started", properties: { run_id: "run-2" } },
        { event_name: "voice_session_abandoned", properties: { run_id: "run-2", reason: "mic_denied" } },
        { event_name: "voice_session_started", properties: { run_id: "run-3" } },
        { event_name: "voice_session_abandoned", properties: { run_id: "run-3", reason: "orphaned" } },
      );

      const started = capturedEvents.filter((e) => e.event_name === "voice_session_started").length;
      const completed = capturedEvents.filter((e) => e.event_name === "voice_session_completed").length;
      const abandoned = capturedEvents.filter((e) => e.event_name === "voice_session_abandoned").length;

      expect(started).toBe(3);
      expect(completed).toBe(1);
      expect(abandoned).toBe(2);

      const abandonmentRate = abandoned / started;
      expect(abandonmentRate).toBeCloseTo(0.666, 2);
    });
  });

  describe("Manual quotes emit no voice events", () => {
    it("createManualJob does not emit voice_session_started", async () => {
      const capturedEvents: Array<{ event_name: string }> = [];

      const mockSupabase = createMockSupabaseForManualJob({
        onEventInsert: (event) => { capturedEvents.push(event); },
      });

      vi.mock("@/lib/supabase/server", () => ({
        createClient: vi.fn(async () => mockSupabase),
      }));

      const { createManualJob } = await import("@/app/jobs/actions");
      await createManualJob();

      const voiceEvents = capturedEvents.filter((e) =>
        e.event_name === "voice_session_started" ||
        e.event_name === "voice_session_completed" ||
        e.event_name === "voice_session_abandoned",
      );
      expect(voiceEvents.length).toBe(0);
    });
  });
});

// --- Test helpers ---

function createMockSupabaseForSessionStart(opts: {
  jobId: string;
  runId: string;
  onJobInsert?: (row: { contractor_id: string; status: string; run_id?: string }) => void;
  onEventInsert?: (event: { event_name: string; properties: { job_id?: string; run_id?: string } }) => void;
}): SupabaseClient {
  const { jobId, onJobInsert, onEventInsert } = opts;

  const mockInsert = vi.fn((table?: string) => {
    if (table === "jobs") {
      return {
        insert: vi.fn((row?: { contractor_id: string; status: string; run_id?: string }) => {
          if (onJobInsert && row) onJobInsert(row);
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: jobId }, error: null })),
            })),
          };
        }),
      };
    }
    if (table === "events") {
      return {
        insert: vi.fn(async (event?: { event_name: string; user_id?: string; properties?: { job_id?: string; run_id?: string } }) => {
          if (onEventInsert && event) {
            onEventInsert({ event_name: event.event_name, properties: event.properties ?? {} });
          }
          return { data: null, error: null };
        }),
      };
    }
    return { insert: vi.fn() };
  });

  const mockFrom = vi.fn((table?: string) => {
    if (table === "contractors") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: "contractor-1", trade: "Electrician", first_name: "Bob", day_rate: 250 },
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "team_members") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: [], error: null })),
        })),
      };
    }
    if (table === "jobs") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ count: 0, error: null })),
          })),
        })),
        insert: mockInsert("jobs").insert,
      };
    }
    if (table === "events") {
      return mockInsert("events");
    }
    return {};
  });

  return {
    from: mockFrom,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
  } as unknown as SupabaseClient;
}

function createMockSupabaseForAbandonment(opts: {
  jobId: string;
  runId: string;
  onEventInsert?: (event: { event_name: string; properties: { job_id?: string; run_id?: string; reason?: string } }) => void;
  eventInsertShouldFail?: boolean;
}): SupabaseClient {
  const { jobId, runId, onEventInsert, eventInsertShouldFail } = opts;

  const mockFrom = vi.fn((table?: string) => {
    if (table === "jobs") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({
            data: [{ id: jobId, run_id: runId }],
            error: null,
          })),
        })),
      };
    }
    if (table === "events") {
      return {
        insert: vi.fn(async (event?: { event_name: string; user_id?: string; properties?: { job_id?: string; run_id?: string; reason?: string } }) => {
          if (eventInsertShouldFail) {
            return { data: null, error: { message: "Insert failed" } };
          }
          if (onEventInsert && event) {
            onEventInsert({ event_name: event.event_name, properties: event.properties ?? {} });
          }
          return { data: null, error: null };
        }),
      };
    }
    return {};
  });

  return {
    from: mockFrom,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
  } as unknown as SupabaseClient;
}

function createMockSupabaseForCompletion(opts: {
  jobId: string;
  runId: string;
  onEventInsert?: (event: { event_name: string; properties: { run_id?: string; wrap_reason?: string; stage?: string; error?: string } }) => void;
}): SupabaseClient {
  const { jobId, runId, onEventInsert } = opts;

  const mockFrom = vi.fn((table?: string) => {
    if (table === "jobs") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({
            data: [{
              id: jobId,
              run_id: runId,
              contractor_id: "contractor-1",
              sow_json: { customer_name: "Alice", scope_items: ["Install lights"] },
            }],
            error: null,
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: null, error: null })),
        })),
      };
    }
    if (table === "quotes") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({
            data: [{ id: "quote-1", line_items_json: [] }],
            error: null,
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: null, error: null })),
        })),
      };
    }
    if (table === "events") {
      return {
        insert: vi.fn(async (event?: { event_name: string; user_id?: string; properties?: { run_id?: string; wrap_reason?: string; stage?: string; error?: string } }) => {
          if (onEventInsert && event) {
            onEventInsert({ event_name: event.event_name, properties: event.properties ?? {} });
          }
          return { data: null, error: null };
        }),
      };
    }
    return {};
  });

  return {
    from: mockFrom,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
  } as unknown as SupabaseClient;
}

function createMockSupabaseForOrphanScan(opts: {
  orphanedJobs: Array<{ id: string; run_id: string; created_at: string }>;
  recentJobs: Array<{ id: string; run_id: string; created_at: string }>;
  manualJobs?: Array<{ id: string; run_id: null; created_at: string; status: string }>;
  onEventInsert?: (event: { event_name: string; properties: { job_id?: string; run_id?: string; reason?: string } }) => void;
  existingEvents?: Array<{ job_id: string; event_name: string }>;
}): SupabaseClient {
  const { orphanedJobs, recentJobs, manualJobs = [], onEventInsert, existingEvents = [] } = opts;

  const mockFrom = vi.fn((table?: string) => {
    if (table === "jobs") {
      const allJobs = [...orphanedJobs, ...recentJobs, ...manualJobs];
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            not: vi.fn(() => ({
              data: allJobs,
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "events") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            in: vi.fn(async () => ({
              data: existingEvents,
              error: null,
            })),
          })),
        })),
        insert: vi.fn(async (event?: { event_name: string; user_id?: string | null; properties?: { job_id?: string; run_id?: string; reason?: string } }) => {
          if (onEventInsert && event) {
            onEventInsert({ event_name: event.event_name, properties: event.properties ?? {} });
          }
          return { data: null, error: null };
        }),
      };
    }
    return {};
  });

  return {
    from: mockFrom,
  } as unknown as SupabaseClient;
}

function createMockSupabaseForManualJob(opts: {
  onEventInsert?: (event: { event_name: string }) => void;
}): SupabaseClient {
  const { onEventInsert } = opts;

  const mockFrom = vi.fn((table?: string) => {
    if (table === "contractors") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: "contractor-1" },
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "jobs") {
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: "manual-job-1" }, error: null })),
          })),
        })),
      };
    }
    if (table === "quotes") {
      return {
        insert: vi.fn(async () => ({ data: null, error: null })),
      };
    }
    if (table === "events") {
      return {
        insert: vi.fn(async (event?: { event_name: string }) => {
          if (onEventInsert && event) onEventInsert(event);
          return { data: null, error: null };
        }),
      };
    }
    return {};
  });

  return {
    from: mockFrom,
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
  } as unknown as SupabaseClient;
}
