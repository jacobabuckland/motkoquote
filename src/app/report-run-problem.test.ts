import { describe, it, expect, vi, beforeEach } from "vitest";

// OBS-4 — the report lands in `events`, and it lands bounded.
//
// `events` rather than a new `feedback` table: it exists, it has policies, and
// the run viewer already reads it. A new table would have needed a migration
// applied by hand ahead of the deploy for no gain over a distinct event_name.
const h = vi.hoisted(() => ({
  // Optional parameters, per AGENTS.md — see the note in
  // voice-funnel-events.test.ts.
  track: vi.fn(async (_name?: string, _properties?: Record<string, unknown>) => {}),
}));

vi.mock("@/lib/analytics", () => ({ track: h.track, logError: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import { reportRunProblem } from "./actions";

const RUN_ID = "44444444-4444-4444-8444-444444444444";

describe("reportRunProblem", () => {
  beforeEach(() => h.track.mockClear());

  it("links the report to the run that produced it", async () => {
    await reportRunProblem({
      run_id: RUN_ID,
      route: "/jobs/x/run",
      note: "said five thousand, quote says five pounds",
      client_log: ["[error] boom"],
    });

    expect(h.track).toHaveBeenCalledWith("run_problem_reported", {
      run_id: RUN_ID,
      job_id: RUN_ID,
      route: "/jobs/x/run",
      note: "said five thousand, quote says five pounds",
      client_log: ["[error] boom"],
    });
  });

  it("bounds the note and the log on the server, not only in the form", async () => {
    await reportRunProblem({
      run_id: RUN_ID,
      route: "/jobs/x/run",
      note: "x".repeat(5000),
      client_log: Array.from({ length: 100 }, (_, i) => `line ${i}`.padEnd(900, "!")),
    });

    const properties = h.track.mock.calls[0]?.[1] as {
      note: string;
      client_log: string[];
    };
    expect(properties.note).toHaveLength(2000);
    expect(properties.client_log).toHaveLength(25);
    expect(properties.client_log[0]).toHaveLength(500);
    // The LAST 25 lines, not the first: the lines nearest the failure are the
    // ones worth keeping.
    expect(properties.client_log[24]?.startsWith("line 99")).toBe(true);
  });

  it("works with no log at all", async () => {
    await reportRunProblem({ run_id: RUN_ID, route: "/jobs/x/run", note: "hm" });

    const properties = h.track.mock.calls[0]?.[1] as { client_log: string[] };
    expect(properties.client_log).toEqual([]);
  });
});
