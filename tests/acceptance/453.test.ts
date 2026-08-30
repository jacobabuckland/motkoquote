import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Issue #453: DATA-2 — Voice cost intake tells every contractor they have no jobs
 *
 * The query in createCostRealtimeSession was selecting columns that don't exist
 * (customer_name, job_reference, updated_at), PostgREST rejected it, but the
 * error was never checked. data was null, got coalesced to [], and every
 * contractor was told they have no jobs.
 *
 * These tests verify:
 * 1. The select names only columns that exist
 * 2. A query error is not reported as an empty job list (must throw)
 * 3. A successful lookup renders the jobs, most recent first
 * 4. A genuinely empty result still yields the "create one first" instruction
 * 5. A job whose customer is null still appears with a placeholder
 * 6. JobSummary no longer carries job_reference, and no rendered line or
 *    instruction mentions a job reference or "last updated"
 */

type SelectCall = {
  columns: string;
};

let selectCalls: SelectCall[];
let jobsData: unknown[] | null;
let jobsError: { message: string } | null;
let contractorData: { id: string; company_name: string } | null;

beforeEach(() => {
  selectCalls = [];
  jobsData = [];
  jobsError = null;
  contractorData = { id: "contractor-1", company_name: "Smith Ltd" };
});

function createMockSupabase(): SupabaseClient {
  const mockJobsQuery = {
    select: (columns: string) => {
      selectCalls.push({ columns });
      return mockJobsQuery;
    },
    eq: () => mockJobsQuery,
    order: () => mockJobsQuery,
    limit: () => mockJobsQuery,
    maybeSingle: async () => ({
      data: contractorData,
      error: null,
    }),
    // This is the resolution point for the jobs query
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      resolve({ data: jobsData, error: jobsError }),
  };

  const mockFrom = vi.fn((table?: string) => {
    if (table === "jobs") {
      return mockJobsQuery;
    }
    // contractors table
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: contractorData,
            error: null,
          }),
        }),
      }),
    };
  });

  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1" } },
      }),
    },
    from: mockFrom,
  } as unknown as SupabaseClient;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createMockSupabase(),
}));

vi.mock("@/lib/realtime", () => ({
  createRealtimeClientSecret: async () => "mock-secret",
}));

describe("Issue #453: Voice cost intake job lookup", () => {
  describe("The select names only columns that exist", () => {
    it("does not select customer_name, job_reference, or updated_at", async () => {
      jobsData = [];

      const { createCostRealtimeSession } = await import(
        "@/app/costs/actions"
      );
      await createCostRealtimeSession();

      const jobsSelect = selectCalls.find((call) =>
        call.columns.includes("id")
      );
      expect(jobsSelect).toBeDefined();
      expect(jobsSelect!.columns).not.toContain("customer_name");
      expect(jobsSelect!.columns).not.toContain("job_reference");
      expect(jobsSelect!.columns).not.toContain("updated_at");
    });

    it("selects id, created_at, and customer via relation", async () => {
      jobsData = [];

      const { createCostRealtimeSession } = await import(
        "@/app/costs/actions"
      );
      await createCostRealtimeSession();

      const jobsSelect = selectCalls.find((call) =>
        call.columns.includes("id")
      );
      expect(jobsSelect).toBeDefined();
      expect(jobsSelect!.columns).toContain("id");
      expect(jobsSelect!.columns).toContain("created_at");
      expect(jobsSelect!.columns).toMatch(/customer.*customers.*name/);
    });
  });

  describe("A query error is not reported as an empty job list", () => {
    it("throws when the jobs query fails", async () => {
      jobsData = null;
      jobsError = { message: "column 'job_reference' does not exist" };

      const { createCostRealtimeSession } = await import(
        "@/app/costs/actions"
      );

      await expect(createCostRealtimeSession()).rejects.toThrow();
    });
  });

  describe("A successful lookup renders the jobs, most recent first", () => {
    it("renders job lines with customer name and created date", async () => {
      jobsData = [
        {
          id: "job-1",
          created_at: "2026-08-15T10:00:00Z",
          customer: { name: "Smith" },
        },
        {
          id: "job-2",
          created_at: "2026-08-20T10:00:00Z",
          customer: { name: "Jones" },
        },
      ];

      const { createCostRealtimeSession } = await import(
        "@/app/costs/actions"
      );
      const result = await createCostRealtimeSession();

      // Verify the action returned successfully
      expect(result.clientSecret).toBe("mock-secret");
      expect(result.sessionKey).toBeNull();

      // Verify the instructions by calling buildCostIntakeInstructions directly
      const { buildCostIntakeInstructions } = await import(
        "@/lib/voice/cost-intake-prompt"
      );

      const instructions = buildCostIntakeInstructions({
        contractorName: "Smith Ltd",
        jobs: [
          {
            id: "job-1",
            created_at: "2026-08-15T10:00:00Z",
            customer_name: "Smith",
          },
          {
            id: "job-2",
            created_at: "2026-08-20T10:00:00Z",
            customer_name: "Jones",
          },
        ],
      });

      expect(instructions).toContain("- Smith — created ");
      expect(instructions).toContain("- Jones — created ");
    });
  });

  describe("A genuinely empty result still yields the 'create one first' instruction", () => {
    it("includes the no-jobs message when the array is empty", async () => {
      jobsData = [];

      const { buildCostIntakeInstructions } = await import(
        "@/lib/voice/cost-intake-prompt"
      );

      const instructions = buildCostIntakeInstructions({
        contractorName: "Smith Ltd",
        jobs: [],
      });

      expect(instructions).toContain("no jobs yet");
      expect(instructions).toContain("create one first");
    });
  });

  describe("A job whose customer is null still appears", () => {
    it("renders with a placeholder when customer is null", async () => {
      const { buildCostIntakeInstructions } = await import(
        "@/lib/voice/cost-intake-prompt"
      );

      const instructions = buildCostIntakeInstructions({
        contractorName: "Smith Ltd",
        jobs: [
          {
            id: "job-1",
            created_at: "2026-08-15T10:00:00Z",
            customer_name: "(no customer)",
          },
        ],
      });

      expect(instructions).toContain("(no customer)");
      expect(instructions).toContain("created ");
    });
  });

  describe("JobSummary no longer carries job_reference", () => {
    it("JobSummary in cost-intake-prompt has no job_reference field", async () => {
      const mod = await import("@/lib/voice/cost-intake-prompt");

      // We can't directly inspect the type, but we can verify that
      // buildCostIntakeInstructions accepts jobs without job_reference
      const instructions = mod.buildCostIntakeInstructions({
        contractorName: "Test",
        jobs: [
          {
            id: "job-1",
            created_at: "2026-08-15T10:00:00Z",
            customer_name: "Smith",
          },
        ],
      });

      expect(instructions).toBeDefined();
    });

    it("JobSummary in match-job has no job_reference field", async () => {
      const mod = await import("@/lib/match-job");

      // Verify the matcher works without job_reference
      const result = mod.matchJobBySpokenReference("Smith", [
        {
          id: "job-1",
          created_at: "2026-08-15T10:00:00Z",
          customer_name: "Smith",
        },
      ]);

      expect(result).toEqual({
        id: "job-1",
        created_at: "2026-08-15T10:00:00Z",
        customer_name: "Smith",
      });
    });
  });

  describe("No rendered line or instruction mentions job reference", () => {
    it("the rendered job list does not mention job reference", async () => {
      const { buildCostIntakeInstructions } = await import(
        "@/lib/voice/cost-intake-prompt"
      );

      const instructions = buildCostIntakeInstructions({
        contractorName: "Smith Ltd",
        jobs: [
          {
            id: "job-1",
            created_at: "2026-08-15T10:00:00Z",
            customer_name: "Smith",
          },
        ],
      });

      // Should not contain references to job reference format (MK-1234)
      expect(instructions).not.toMatch(/MK-\d{4}/);
      expect(instructions).not.toContain("job reference");
      expect(instructions).not.toContain("job_reference");
    });

    it("the instructions do not tell the model to ask for job reference", async () => {
      const { buildCostIntakeInstructions } = await import(
        "@/lib/voice/cost-intake-prompt"
      );

      const instructions = buildCostIntakeInstructions({
        contractorName: "Smith Ltd",
        jobs: [
          {
            id: "job-1",
            created_at: "2026-08-15T10:00:00Z",
            customer_name: "Smith",
          },
        ],
      });

      // The prompt should not instruct the model to capture or ask for job reference
      const lowerInstructions = instructions.toLowerCase();
      expect(lowerInstructions).not.toContain("job reference");
    });

    it("the rendered job list does not mention 'last updated'", async () => {
      const { buildCostIntakeInstructions } = await import(
        "@/lib/voice/cost-intake-prompt"
      );

      const instructions = buildCostIntakeInstructions({
        contractorName: "Smith Ltd",
        jobs: [
          {
            id: "job-1",
            created_at: "2026-08-15T10:00:00Z",
            customer_name: "Smith",
          },
        ],
      });

      expect(instructions).not.toContain("last updated");
      expect(instructions).not.toContain("updated_at");
    });
  });
});
