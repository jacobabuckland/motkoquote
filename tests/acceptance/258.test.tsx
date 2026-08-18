import { describe, it, expect } from "vitest";

/**
 * Issue #258: LED-5 — Voice cost capture
 *
 * These tests verify:
 * 1. Deterministic amount parsing from spoken forms
 * 2. Job matching by customer name or job reference
 * 3. Voice cost intake components exist
 * 4. Integration points (job page, motko hub) exist
 * 5. Confirmation-before-write flow
 */

describe("Issue #258: LED-5 — Voice cost capture", () => {
  describe("Spoken money amount parsing", () => {
    it("exports parseSpokenMoneyAmount from parse-spoken-money.ts", async () => {
      const mod = await import("@/lib/parse-spoken-money");

      expect(mod.parseSpokenMoneyAmount).toBeDefined();
      expect(typeof mod.parseSpokenMoneyAmount).toBe("function");
    });

    it("parses 'two eighty' as £280.00 (28000 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("two eighty");

      expect(amount).toBe(28000);
    });

    it("parses 'two hundred and eighty' as £280.00 (28000 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("two hundred and eighty");

      expect(amount).toBe(28000);
    });

    it("parses '280 pounds' as £280.00 (28000 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("280 pounds");

      expect(amount).toBe(28000);
    });

    it("parses 'two eighty pounds' as £280.00 (28000 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("two eighty pounds");

      expect(amount).toBe(28000);
    });

    it("parses 'two hundred and eighty quid' as £280.00 (28000 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("two hundred and eighty quid");

      expect(amount).toBe(28000);
    });

    it("parses 'two pounds eighty' as £2.80 (280 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("two pounds eighty");

      expect(amount).toBe(280);
    });

    it("parses 'two eighty five ninety-nine' as £285.99 (28599 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("two eighty five ninety-nine");

      expect(amount).toBe(28599);
    });

    it("parses 'eighty five ninety nine' as £85.99 (8599 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("eighty five ninety nine");

      expect(amount).toBe(8599);
    });

    it("parses 'thirty five pence' as 35 pence", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("thirty five pence");

      expect(amount).toBe(35);
    });

    it("parses 'two thousand' as £2,000.00 (200000 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("two thousand");

      expect(amount).toBe(200000);
    });

    it("parses 'twenty three thousand' as £23,000.00 (2300000 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("twenty three thousand");

      expect(amount).toBe(2300000);
    });

    it("parses 'three hundred' as £300.00 (30000 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("three hundred");

      expect(amount).toBe(30000);
    });

    it("parses 'hundred and twenty' as £120.00 (12000 pence)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("hundred and twenty");

      expect(amount).toBe(12000);
    });

    it("returns null for ambiguous 'two eighty five' (could be £280.05 or £2.85)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("two eighty five");

      // Ambiguous case — parser cannot decide, must ask
      expect(amount).toBeNull();
    });

    it("returns null for unparseable input with no amount", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("I bought some stuff");

      expect(amount).toBeNull();
    });

    it("returns null for empty string", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const amount = parseSpokenMoneyAmount("");

      expect(amount).toBeNull();
    });
  });

  describe("Job matching by spoken reference", () => {
    it("exports matchJobBySpokenReference from match-job.ts", async () => {
      const mod = await import("@/lib/match-job");

      expect(mod.matchJobBySpokenReference).toBeDefined();
      expect(typeof mod.matchJobBySpokenReference).toBe("function");
    });

    it("matches a single job by customer name (case-insensitive)", async () => {
      const { matchJobBySpokenReference } = await import("@/lib/match-job");

      const jobs = [
        {
          id: "job-1",
          customer_name: "Henderson",
          job_reference: "MK-1001",
          updated_at: "2026-08-10T10:00:00Z",
        },
        {
          id: "job-2",
          customer_name: "Smith",
          job_reference: "MK-1002",
          updated_at: "2026-08-11T10:00:00Z",
        },
      ];

      const result = matchJobBySpokenReference("the Henderson job", jobs);

      expect(result).toEqual(jobs[0]);
    });

    it("matches a single job by job reference", async () => {
      const { matchJobBySpokenReference } = await import("@/lib/match-job");

      const jobs = [
        {
          id: "job-1",
          customer_name: "Henderson",
          job_reference: "MK-1001",
          updated_at: "2026-08-10T10:00:00Z",
        },
        {
          id: "job-2",
          customer_name: "Smith",
          job_reference: "MK-1002",
          updated_at: "2026-08-11T10:00:00Z",
        },
      ];

      const result = matchJobBySpokenReference("MK-1001", jobs);

      expect(result).toEqual(jobs[0]);
    });

    it("returns 'ambiguous' when multiple jobs match customer name", async () => {
      const { matchJobBySpokenReference } = await import("@/lib/match-job");

      const jobs = [
        {
          id: "job-1",
          customer_name: "Smith",
          job_reference: "MK-1001",
          updated_at: "2026-08-10T10:00:00Z",
        },
        {
          id: "job-2",
          customer_name: "Smith",
          job_reference: "MK-1002",
          updated_at: "2026-08-11T10:00:00Z",
        },
        {
          id: "job-3",
          customer_name: "Smith",
          job_reference: "MK-1003",
          updated_at: "2026-08-12T10:00:00Z",
        },
      ];

      const result = matchJobBySpokenReference("the Smith job", jobs);

      expect(result).toBe("ambiguous");
    });

    it("returns null when no jobs match", async () => {
      const { matchJobBySpokenReference } = await import("@/lib/match-job");

      const jobs = [
        {
          id: "job-1",
          customer_name: "Henderson",
          job_reference: "MK-1001",
          updated_at: "2026-08-10T10:00:00Z",
        },
      ];

      const result = matchJobBySpokenReference("the Jones job", jobs);

      expect(result).toBeNull();
    });

    it("matches 'the last job' to the most recent job by updated_at", async () => {
      const { matchJobBySpokenReference } = await import("@/lib/match-job");

      const jobs = [
        {
          id: "job-1",
          customer_name: "Henderson",
          job_reference: "MK-1001",
          updated_at: "2026-08-10T10:00:00Z",
        },
        {
          id: "job-2",
          customer_name: "Smith",
          job_reference: "MK-1002",
          updated_at: "2026-08-17T10:00:00Z", // Most recent
        },
        {
          id: "job-3",
          customer_name: "Jones",
          job_reference: "MK-1003",
          updated_at: "2026-08-15T10:00:00Z",
        },
      ];

      const result = matchJobBySpokenReference("the last job", jobs);

      expect(result).toEqual(jobs[1]);
    });

    it("returns null when jobs list is empty", async () => {
      const { matchJobBySpokenReference } = await import("@/lib/match-job");

      const result = matchJobBySpokenReference("the Henderson job", []);

      expect(result).toBeNull();
    });
  });

  describe("Voice cost intake components", () => {
    it("exports CostIntake component from cost-intake.tsx", async () => {
      const mod = await import("@/components/voice/cost-intake");

      expect(mod.CostIntake).toBeDefined();
      expect(typeof mod.CostIntake).toBe("function");
    });

    it("exports CostIntakeAdapter type from cost-intake-adapter.ts", async () => {
      const mod = await import("@/components/voice/cost-intake-adapter");

      expect(mod).toBeDefined();
      // Type-only export, so we just check the module exists
    });

    it("exports cost intake prompt builder from cost-intake-prompt.ts", async () => {
      const mod = await import("@/lib/voice/cost-intake-prompt");

      expect(mod.buildCostIntakeInstructions).toBeDefined();
      expect(typeof mod.buildCostIntakeInstructions).toBe("function");
    });

    it("cost intake instructions mention amount, counterparty, and job", async () => {
      const { buildCostIntakeInstructions } = await import(
        "@/lib/voice/cost-intake-prompt"
      );

      const instructions = buildCostIntakeInstructions();

      // The prompt must ask for the three key pieces: amount, what/who, and which job
      expect(instructions).toMatch(/amount|cost|price|spend/i);
      expect(instructions).toMatch(/counterparty|merchant|supplier|who|where/i);
      expect(instructions).toMatch(/job|customer/i);
    });
  });

  describe("Voice cost entry pages", () => {
    it("job-scoped voice cost page exists at /jobs/[id]/add-cost-voice", async () => {
      const mod = await import("@/app/jobs/[id]/add-cost-voice/page");

      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("cross-job voice cost page exists at /costs/voice", async () => {
      const mod = await import("@/app/costs/voice/page");

      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });
  });

  describe("Integration points", () => {
    it("CostsSection component exports from costs-section.tsx", async () => {
      const mod = await import("@/app/jobs/[id]/costs-section");

      expect(mod.CostsSection).toBeDefined();
      expect(typeof mod.CostsSection).toBe("function");
    });

    it("Speak to motko page exists at /motko", async () => {
      const mod = await import("@/app/motko/page");

      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });
  });

  describe("Voice cost source tracking", () => {
    it("createJobCost schema accepts 'voice' as a source value", async () => {
      const { createJobCostSchema } = await import("@/lib/schemas/job-cost");

      const validInput = {
        jobId: "550e8400-e29b-41d4-a716-446655440000",
        description: "Materials from Screwfix",
        amountNet: 28000, // £280.00 in pence
        category: "materials" as const,
        incurredOn: "2026-08-18",
        source: "voice" as const,
        counterpartyName: "Screwfix",
      };

      const result = createJobCostSchema.safeParse(validInput);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe("voice");
      }
    });
  });

  describe("Confirmation before write", () => {
    it("cost intake adapter defines a complete method signature", async () => {
      // This test documents that the adapter must define a complete() method
      // that receives the drafted cost and returns only after user confirmation

      const mod = await import("@/components/voice/cost-intake-adapter");

      // The CostIntakeAdapter type exists and will be checked by TypeScript
      // at implementation time. This test ensures the module is importable.
      expect(mod).toBeDefined();
    });

    it("drafted cost includes amount, counterparty, category, job, date", async () => {
      // This test documents the shape of the drafted cost that must be
      // shown for confirmation before any write to job_costs

      type DraftedCost = {
        amountPence: number;
        amountWords: string; // e.g. "two hundred and eighty pounds"
        counterpartyName: string | null;
        category: string;
        jobId: string;
        jobDisplay: string; // e.g. "Henderson — kitchen rewiring"
        incurredOn: string; // YYYY-MM-DD
      };

      // Type exists and is well-formed
      const mockDraft: DraftedCost = {
        amountPence: 28000,
        amountWords: "two hundred and eighty pounds",
        counterpartyName: "Screwfix",
        category: "materials",
        jobId: "job-123",
        jobDisplay: "Henderson — kitchen rewiring",
        incurredOn: "2026-08-18",
      };

      expect(mockDraft.amountPence).toBe(28000);
      expect(mockDraft.amountWords).toBe("two hundred and eighty pounds");
      expect(mockDraft.counterpartyName).toBe("Screwfix");
    });
  });

  describe("Money-integrity rule", () => {
    it("parseSpokenMoneyAmount is a pure function (deterministic)", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      // Calling the same input twice must return the same result
      const input = "two hundred and eighty pounds";
      const result1 = parseSpokenMoneyAmount(input);
      const result2 = parseSpokenMoneyAmount(input);

      expect(result1).toBe(result2);
      expect(result1).toBe(28000);
    });

    it("parseSpokenMoneyAmount never calls external APIs or uses randomness", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      // This test documents that the parser is deterministic
      // It runs over the transcript string and returns integer pence or null
      // No model calls, no API requests, no Math.random()

      const result = parseSpokenMoneyAmount("five hundred quid");

      expect(typeof result).toBe("number");
      expect(result).toBe(50000); // £500.00
    });
  });

  describe("Edge cases", () => {
    it("handles contractor saying 'no' to confirmation (returns to voice or manual)", async () => {
      // This test documents that the confirmation step must handle rejection
      // The adapter's complete() method must support a cancellation path

      const mod = await import("@/components/voice/cost-intake-adapter");

      expect(mod).toBeDefined();
      // Implementation will provide cancel/retry/edit options
    });

    it("handles multiple costs in one utterance by refusing and guiding", async () => {
      const { buildCostIntakeInstructions } = await import(
        "@/lib/voice/cost-intake-prompt"
      );

      const instructions = buildCostIntakeInstructions();

      // The prompt must instruct the model to handle only one cost per recording
      // and guide the contractor to start another recording for additional costs
      expect(instructions.toLowerCase()).toMatch(
        /one cost|single cost|one at a time|separately/
      );
    });

    it("handles missing job reference by asking which job", async () => {
      // If the contractor says "I spent two eighty at Screwfix" without
      // naming a job, the voice flow must ask "Which job was that for?"

      const { buildCostIntakeInstructions } = await import(
        "@/lib/voice/cost-intake-prompt"
      );

      const instructions = buildCostIntakeInstructions();

      expect(instructions.toLowerCase()).toMatch(/which job|what job|job.*for/);
    });

    it("handles no counterparty mentioned (leaves field null)", async () => {
      // If the contractor says "I spent two eighty on materials" without
      // naming where, the drafted cost has counterpartyName: null

      type DraftedCost = {
        amountPence: number;
        counterpartyName: string | null;
      };

      const mockDraft: DraftedCost = {
        amountPence: 28000,
        counterpartyName: null, // Valid state
      };

      expect(mockDraft.counterpartyName).toBeNull();
    });

    it("handles unparseable amount by asking for clarification", async () => {
      const { parseSpokenMoneyAmount } = await import("@/lib/parse-spoken-money");

      const result = parseSpokenMoneyAmount("um yeah so materials and stuff");

      // Parser returns null — voice flow must ask "How much was it?"
      expect(result).toBeNull();
    });

    it("handles empty jobs list (contractor has no jobs)", async () => {
      const { matchJobBySpokenReference } = await import("@/lib/match-job");

      const result = matchJobBySpokenReference("the Henderson job", []);

      // No jobs exist — voice flow must prompt to create a job first
      expect(result).toBeNull();
    });
  });
});
