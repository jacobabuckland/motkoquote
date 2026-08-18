import { describe, expect, it, vi } from "vitest";

describe("LED-6: Voice query over the ledger", () => {
  describe("Voice query handler", () => {
    it("exists as an importable function", async () => {
      const mod = await import("@/lib/voice/ledger-query");
      expect(mod.handleLedgerQuery).toBeDefined();
      expect(typeof mod.handleLedgerQuery).toBe("function");
    });

    it("classifies 'what am I owed' to outstanding invoices query", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");
      const { computeOutstandingTotal } = await import("@/lib/ledger/projections");

      const mockComputeOutstanding = vi.fn(async () => ({
        total: 5000,
        invoices: [
          { id: "inv-1", amount: 3000, dueDate: "2026-08-01", customerName: "Alice Ltd" },
          { id: "inv-2", amount: 2000, dueDate: "2026-08-10", customerName: "Bob Builders" },
        ],
      }));

      vi.spyOn({ computeOutstandingTotal }, "computeOutstandingTotal").mockImplementation(
        mockComputeOutstanding
      );

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "What am I owed?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      expect(result.queryType).toBe("outstanding");
      expect(result.computedValues.total).toBe(5000);
      expect(result.spokenResponse).toBeDefined();
      expect(typeof result.spokenResponse).toBe("string");
    });

    it("classifies 'what do I owe' to unpaid costs query", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");
      const { computeUnpaidCosts } = await import("@/lib/ledger/projections");

      const mockComputeUnpaid = vi.fn(async () => ({
        total: 2400,
        byCounterparty: [
          { counterparty: "Tool Hire Ltd", amount: 1500 },
          { counterparty: "Builders Merchants", amount: 900 },
        ],
      }));

      vi.spyOn({ computeUnpaidCosts }, "computeUnpaidCosts").mockImplementation(mockComputeUnpaid);

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "What do I owe?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      expect(result.queryType).toBe("unpaid_costs");
      expect(result.computedValues.total).toBe(2400);
      expect(result.spokenResponse).toContain("Tool Hire");
    });

    it("classifies 'what do I owe [counterparty]' to filtered unpaid costs", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");
      const { computeUnpaidCostsForCounterparty } = await import("@/lib/ledger/projections");

      const mockComputeUnpaidForCounterparty = vi.fn(async () => ({
        counterparty: "Tool Hire Ltd",
        amount: 1500,
      }));

      vi.spyOn(
        { computeUnpaidCostsForCounterparty },
        "computeUnpaidCostsForCounterparty"
      ).mockImplementation(mockComputeUnpaidForCounterparty);

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "What do I owe Tool Hire?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      expect(result.queryType).toBe("unpaid_costs_counterparty");
      expect(result.computedValues.amount).toBe(1500);
      expect(result.spokenResponse).toContain("Tool Hire");
    });

    it("classifies 'what did [job] make' to job P&L query", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");
      const { computeJobProfitAndLoss } = await import("@/lib/ledger/projections");

      const mockComputeJobPL = vi.fn(async () => ({
        jobId: "job-1",
        revenue: 10000,
        costs: 3500,
        profit: 6500,
      }));

      vi.spyOn({ computeJobProfitAndLoss }, "computeJobProfitAndLoss").mockImplementation(
        mockComputeJobPL
      );

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "What did the kitchen job make?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      expect(result.queryType).toBe("job_pl");
      expect(result.computedValues.profit).toBe(6500);
      expect(result.spokenResponse).toBeDefined();
    });

    it("classifies 'what's left' to collected minus paid costs", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");
      const { computeWhatsLeft } = await import("@/lib/ledger/projections");

      const mockComputeWhatsLeft = vi.fn(async () => ({
        collected: 15000,
        paidCosts: 8000,
        remaining: 7000,
      }));

      vi.spyOn({ computeWhatsLeft }, "computeWhatsLeft").mockImplementation(mockComputeWhatsLeft);

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "What's left?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      expect(result.queryType).toBe("whats_left");
      expect(result.computedValues.remaining).toBe(7000);
      expect(result.spokenResponse).toBeDefined();
    });

    it("rejects out-of-set queries with available options", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "How does this month compare to last month?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      expect(result.queryType).toBe("unsupported");
      expect(result.spokenResponse).toContain("can't answer that yet");
      expect(result.spokenResponse.toLowerCase()).toMatch(/what.*owed|what.*owe|job.*make|left/);
    });
  });

  describe("Ledger projections", () => {
    it("computeOutstandingTotal sums unpaid invoice amounts", async () => {
      const { computeOutstandingTotal } = await import("@/lib/ledger/projections");

      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            neq: vi.fn(() => ({
              eq: vi.fn(() => ({
                data: [
                  { id: "inv-1", amount: 3000, status: "sent" },
                  { id: "inv-2", amount: 2000, status: "sent" },
                ],
                error: null,
              })),
            })),
          })),
        })),
      } as never;

      const result = await computeOutstandingTotal(mockSupabase, "contractor-1");

      expect(result.total).toBe(5000);
      expect(result.invoices).toHaveLength(2);
    });

    it("computeUnpaidCosts groups by counterparty", async () => {
      const { computeUnpaidCosts } = await import("@/lib/ledger/projections");

      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              neq: vi.fn(() => ({
                data: [
                  { id: "cost-1", amount: 1500, counterparty: "Tool Hire Ltd", paid: false },
                  { id: "cost-2", amount: 900, counterparty: "Builders Merchants", paid: false },
                  { id: "cost-3", amount: 600, counterparty: "Tool Hire Ltd", paid: false },
                ],
                error: null,
              })),
            })),
          })),
        })),
      } as never;

      const result = await computeUnpaidCosts(mockSupabase, "contractor-1");

      expect(result.total).toBe(3000);
      expect(result.byCounterparty).toHaveLength(2);
      const toolHire = result.byCounterparty.find((c) => c.counterparty === "Tool Hire Ltd");
      expect(toolHire?.amount).toBe(2100);
    });

    it("computeJobProfitAndLoss calculates revenue minus costs", async () => {
      const { computeJobProfitAndLoss } = await import("@/lib/ledger/projections");

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "invoices") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  data: [
                    { id: "inv-1", amount: 10000, status: "paid" },
                  ],
                  error: null,
                })),
              })),
            };
          }
          if (table === "costs") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  data: [
                    { id: "cost-1", amount: 3500, paid: true },
                  ],
                  error: null,
                })),
              })),
            };
          }
          return {} as never;
        }),
      } as never;

      const result = await computeJobProfitAndLoss(mockSupabase, "job-1", "contractor-1");

      expect(result.revenue).toBe(10000);
      expect(result.costs).toBe(3500);
      expect(result.profit).toBe(6500);
    });

    it("computeWhatsLeft calculates collected minus paid costs", async () => {
      const { computeWhatsLeft } = await import("@/lib/ledger/projections");

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "invoices") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  data: [
                    { id: "inv-1", amount: 10000, status: "paid" },
                    { id: "inv-2", amount: 5000, status: "paid" },
                  ],
                  error: null,
                })),
              })),
            };
          }
          if (table === "costs") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  data: [
                    { id: "cost-1", amount: 8000, paid: true },
                  ],
                  error: null,
                })),
              })),
            };
          }
          return {} as never;
        }),
      } as never;

      const result = await computeWhatsLeft(mockSupabase, "contractor-1");

      expect(result.collected).toBe(15000);
      expect(result.paidCosts).toBe(8000);
      expect(result.remaining).toBe(7000);
    });
  });

  describe("Amount speech formatting", () => {
    it("formats amounts as natural British speech", async () => {
      const { formatAmountAsSpeech } = await import("@/lib/format-amount-speech");

      expect(formatAmountAsSpeech(1240)).toBe("twelve hundred and forty pounds");
      expect(formatAmountAsSpeech(5000)).toBe("five thousand pounds");
      expect(formatAmountAsSpeech(25340)).toBe("twenty-five thousand, three hundred and forty pounds");
    });

    it("handles zero amounts", async () => {
      const { formatAmountAsSpeech } = await import("@/lib/format-amount-speech");

      expect(formatAmountAsSpeech(0)).toBe("zero");
    });

    it("handles pence correctly", async () => {
      const { formatAmountAsSpeech } = await import("@/lib/format-amount-speech");

      expect(formatAmountAsSpeech(1250)).toContain("twelve hundred and fifty");
      expect(formatAmountAsSpeech(1250)).not.toContain("pence");
    });
  });

  describe("Computation functions are shared between voice and screen", () => {
    it("dashboard uses the same computeOutstandingTotal as voice queries", async () => {
      const { computeOutstandingTotal } = await import("@/lib/ledger/projections");

      // Dashboard computes outstanding as: openInvoices.reduce((sum, invoice) => sum + invoice.amount, 0)
      // Voice queries must call computeOutstandingTotal, which performs the same calculation
      // This test asserts the function exists and is the single source of truth
      expect(computeOutstandingTotal).toBeDefined();
      expect(typeof computeOutstandingTotal).toBe("function");
    });

    it("voice query calls computeOutstandingTotal, not inline arithmetic", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");
      const projections = await import("@/lib/ledger/projections");

      const spy = vi.spyOn(projections, "computeOutstandingTotal");
      spy.mockResolvedValue({
        total: 5000,
        invoices: [],
      });

      const mockSupabase = {} as never;
      await handleLedgerQuery({
        query: "What am I owed?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(mockSupabase, "contractor-1");
    });
  });

  describe("Privacy: customer names only when contractor named them", () => {
    it("omits customer names from generic 'what am I owed' query", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");

      vi.doMock("@/lib/ledger/projections", () => ({
        computeOutstandingTotal: vi.fn(async () => ({
          total: 5000,
          invoices: [
            { id: "inv-1", amount: 3000, customerName: "Sensitive Customer Ltd" },
            { id: "inv-2", amount: 2000, customerName: "Private Individual" },
          ],
        })),
      }));

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "What am I owed?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      // Should NOT contain customer names when not explicitly asked
      expect(result.spokenResponse).not.toContain("Sensitive Customer");
      expect(result.spokenResponse).not.toContain("Private Individual");
    });

    it("includes customer name when contractor asked about specific customer", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");

      vi.doMock("@/lib/ledger/projections", () => ({
        computeJobProfitAndLoss: vi.fn(async () => ({
          jobId: "job-1",
          customerName: "Alice Ltd",
          revenue: 10000,
          costs: 3500,
          profit: 6500,
        })),
      }));

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "What did the Alice job make?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      // Should include customer name when explicitly named in the query
      expect(result.spokenResponse).toContain("Alice");
    });
  });

  describe("No arithmetic by LLM", () => {
    it("voice response contains pre-computed values, not LLM-calculated", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");

      vi.doMock("@/lib/ledger/projections", () => ({
        computeJobProfitAndLoss: vi.fn(async () => ({
          jobId: "job-1",
          revenue: 10000,
          costs: 3500,
          profit: 6500, // Pre-computed by code, not by LLM
        })),
      }));

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "What did the kitchen job make?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      // The result must contain the exact pre-computed profit value
      // LLM must NOT receive revenue and costs and calculate profit itself
      expect(result.computedValues.profit).toBe(6500);
      expect(result.computedValues.revenue).toBe(10000);
      expect(result.computedValues.costs).toBe(3500);
    });
  });

  describe("Empty states", () => {
    it("handles no outstanding invoices gracefully", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");

      vi.doMock("@/lib/ledger/projections", () => ({
        computeOutstandingTotal: vi.fn(async () => ({
          total: 0,
          invoices: [],
        })),
      }));

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "What am I owed?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      expect(result.spokenResponse.toLowerCase()).toMatch(/all square|nothing|zero/);
    });

    it("handles no unpaid costs gracefully", async () => {
      const { handleLedgerQuery } = await import("@/lib/voice/ledger-query");

      vi.doMock("@/lib/ledger/projections", () => ({
        computeUnpaidCosts: vi.fn(async () => ({
          total: 0,
          byCounterparty: [],
        })),
      }));

      const mockSupabase = {} as never;
      const result = await handleLedgerQuery({
        query: "What do I owe?",
        supabase: mockSupabase,
        contractorId: "contractor-1",
      });

      expect(result.spokenResponse.toLowerCase()).toMatch(/nothing|don't owe/);
    });
  });
});
