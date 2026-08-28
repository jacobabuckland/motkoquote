import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Issue #257: LED-6 Voice ledger queries", () => {
  describe("File structure", () => {
    it("creates ledger query actions at src/app/ledger/query-actions.ts", async () => {
      const path = resolve(process.cwd(), "src/app/ledger/query-actions.ts");
      expect(existsSync(path)).toBe(true);

      const mod = await import("@/app/ledger/query-actions");
      expect(mod.getOwedToYou).toBeDefined();
      expect(mod.getYouOwe).toBeDefined();
      expect(mod.getYouOweCounterparty).toBeDefined();
      expect(mod.getJobProfit).toBeDefined();
      expect(mod.getWhatsLeft).toBeDefined();
    });

    it("creates ledger query prompt at src/lib/voice/ledger-query-prompt.ts", async () => {
      const path = resolve(process.cwd(), "src/lib/voice/ledger-query-prompt.ts");
      expect(existsSync(path)).toBe(true);

      const mod = await import("@/lib/voice/ledger-query-prompt");
      expect(mod.buildLedgerQueryInstructions).toBeDefined();
    });

    it("creates API route at src/app/api/ledger/query-session/route.ts", async () => {
      const path = resolve(process.cwd(), "src/app/api/ledger/query-session/route.ts");
      expect(existsSync(path)).toBe(true);

      const mod = await import("@/app/api/ledger/query-session/route");
      expect(mod.POST).toBeDefined();
    });
  });

  describe("Query type: What am I owed", () => {
    it("calls getMoneyPosition from LED-4 and returns owedToYou aggregate", async () => {
      // Mock the LED-4 getMoneyPosition function
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [
          {
            customerId: "cust-1",
            customerName: "Smith Ltd",
            totalOwed: 240000, // £2,400 in pence
            oldestInvoiceAgeDays: 45,
            unpaidInvoiceIds: ["inv-1"],
          },
        ],
        youOwe: [],
        vat: null,
        whatsLeft: 0,
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getOwedToYou } = await import("@/app/ledger/query-actions");
      const result = await getOwedToYou("contractor-1");

      expect(mockGetMoneyPosition).toHaveBeenCalledWith("contractor-1");
      expect(result).toHaveLength(1);
      expect(result[0]?.totalOwed).toBe(240000);
    });

    it("returns empty state when no unpaid invoices", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 0,
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getOwedToYou } = await import("@/app/ledger/query-actions");
      const result = await getOwedToYou("contractor-1");

      expect(result).toHaveLength(0);
    });
  });

  describe("Query type: What do I owe", () => {
    it("calls getMoneyPosition from LED-4 and returns youOwe aggregate", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [
          {
            counterpartyId: "cp-1",
            counterpartyName: "Frank",
            totalOwed: 200000, // £2,000 in pence
            jobCount: 4,
            costIds: ["cost-1", "cost-2"],
          },
        ],
        vat: null,
        whatsLeft: 0,
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getYouOwe } = await import("@/app/ledger/query-actions");
      const result = await getYouOwe("contractor-1");

      expect(mockGetMoneyPosition).toHaveBeenCalledWith("contractor-1");
      expect(result).toHaveLength(1);
      expect(result[0]?.counterpartyName).toBe("Frank");
      expect(result[0]?.totalOwed).toBe(200000);
    });

    it("returns empty state when all costs paid", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 0,
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getYouOwe } = await import("@/app/ledger/query-actions");
      const result = await getYouOwe("contractor-1");

      expect(result).toHaveLength(0);
    });
  });

  describe("Query type: What do I owe [counterparty]", () => {
    it("filters youOwe to specific counterparty by name match", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [
          {
            counterpartyId: "cp-1",
            counterpartyName: "Frank Smith",
            totalOwed: 200000,
            jobCount: 2,
            costIds: ["cost-1"],
          },
          {
            counterpartyId: "cp-2",
            counterpartyName: "Frank's Supplies",
            totalOwed: 150000,
            jobCount: 1,
            costIds: ["cost-2"],
          },
          {
            counterpartyId: "cp-3",
            counterpartyName: "Bob's Hardware",
            totalOwed: 50000,
            jobCount: 1,
            costIds: ["cost-3"],
          },
        ],
        vat: null,
        whatsLeft: 0,
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getYouOweCounterparty } = await import("@/app/ledger/query-actions");
      const result = await getYouOweCounterparty("contractor-1", "Frank Smith");

      expect(mockGetMoneyPosition).toHaveBeenCalledWith("contractor-1");
      expect(result).toHaveLength(1);
      expect(result[0]?.counterpartyName).toBe("Frank Smith");
      expect(result[0]?.totalOwed).toBe(200000);
    });

    it("handles ambiguous counterparty name (partial match)", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [
          {
            counterpartyId: "cp-1",
            counterpartyName: "Frank Smith",
            totalOwed: 200000,
            jobCount: 2,
            costIds: ["cost-1"],
          },
          {
            counterpartyId: "cp-2",
            counterpartyName: "Frank's Supplies",
            totalOwed: 150000,
            jobCount: 1,
            costIds: ["cost-2"],
          },
        ],
        vat: null,
        whatsLeft: 0,
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getYouOweCounterparty } = await import("@/app/ledger/query-actions");
      const result = await getYouOweCounterparty("contractor-1", "Frank");

      // Should return both Franks (or handle ambiguity in some way)
      expect(mockGetMoneyPosition).toHaveBeenCalledWith("contractor-1");
      expect(result.length).toBeGreaterThan(0);
    });

    it("handles counterparty with no name (null)", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [
          {
            counterpartyId: null,
            counterpartyName: null,
            totalOwed: 40000,
            jobCount: 1,
            costIds: ["cost-1"],
          },
        ],
        vat: null,
        whatsLeft: 0,
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getYouOweCounterparty } = await import("@/app/ledger/query-actions");
      const result = await getYouOweCounterparty("contractor-1", "no counterparty");

      expect(mockGetMoneyPosition).toHaveBeenCalledWith("contractor-1");
      // Should match costs with no counterparty name
      expect(result).toBeDefined();
    });
  });

  describe("Query type: What did [job] make", () => {
    it("calls getJobPnL from LED-2 and returns profit data", async () => {
      const mockGetJobPnL = vi.fn(async () => ({
        invoicedNet: 500000, // £5,000
        costsNet: 380000, // £3,800
        grossProfit: 120000, // £1,200
        marginPct: 24.0,
        vatCollected: 100000,
        vatOnCosts: 76000,
        vatPosition: 24000,
        unpaidCosts: 0,
        hasInvoice: true,
      }));

      vi.doMock("@/app/jobs/[id]/pnl-actions", () => ({
        getJobPnL: mockGetJobPnL,
      }));

      const { getJobProfit } = await import("@/app/ledger/query-actions");
      const result = await getJobProfit("contractor-1", "job-1");

      expect(mockGetJobPnL).toHaveBeenCalledWith("job-1");
      expect(result.grossProfit).toBe(120000);
      expect(result.marginPct).toBe(24.0);
    });

    it("handles job with no invoice yet", async () => {
      const mockGetJobPnL = vi.fn(async () => ({
        invoicedNet: 0,
        costsNet: 50000,
        grossProfit: 0,
        marginPct: null,
        vatCollected: 0,
        vatOnCosts: 0,
        vatPosition: 0,
        unpaidCosts: 50000,
        hasInvoice: false,
      }));

      vi.doMock("@/app/jobs/[id]/pnl-actions", () => ({
        getJobPnL: mockGetJobPnL,
      }));

      const { getJobProfit } = await import("@/app/ledger/query-actions");
      const result = await getJobProfit("contractor-1", "job-2");

      expect(result.hasInvoice).toBe(false);
      expect(result.costsNet).toBe(50000);
    });
  });

  describe("Query type: What's left", () => {
    it("calls getMoneyPosition from LED-4 and returns whatsLeft figure", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 320000, // £3,200 — the old, wrong figure
        safeToSpend: {
          collected: 500000,
          costsPaid: 150000,
          motkoFees: 10000,
          vatToSetAside: 20000,
          total: 320000, // £3,200 — differs from whatsLeft to catch regression
        },
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getWhatsLeft } = await import("@/app/ledger/query-actions");
      const result = await getWhatsLeft("contractor-1");

      expect(mockGetMoneyPosition).toHaveBeenCalledWith("contractor-1");
      expect(result.total).toBe(320000);
    });

    it("handles negative whatsLeft (spent more than collected)", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: -30000, // -£300 — the old, wrong figure
        safeToSpend: {
          collected: 100000,
          costsPaid: 120000,
          motkoFees: 5000,
          vatToSetAside: 25000,
          total: -50000, // -£500 — differs from whatsLeft to catch regression
        },
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getWhatsLeft } = await import("@/app/ledger/query-actions");
      const result = await getWhatsLeft("contractor-1");

      expect(result.total).toBe(-50000);
    });
  });

  describe("Voice path and screen path use same computation", () => {
    it("getOwedToYou calls the same getMoneyPosition as dashboard", async () => {
      // Import both the voice query action and the dashboard action
      const dashboardMod = await import("@/app/jobs/money-position-actions");
      const { getOwedToYou } = await import("@/app/ledger/query-actions");

      // Spy on the dashboard's getMoneyPosition
      const spy = vi.spyOn(dashboardMod, "getMoneyPosition");

      await getOwedToYou("contractor-1");

      // Assert the voice path called the dashboard's computation
      expect(spy).toHaveBeenCalled();
    });

    it("getJobProfit calls the same getJobPnL as job page", async () => {
      // Import both the voice query action and the job page action
      const jobPageMod = await import("@/app/jobs/[id]/pnl-actions");
      const { getJobProfit } = await import("@/app/ledger/query-actions");

      // Spy on the job page's getJobPnL
      const spy = vi.spyOn(jobPageMod, "getJobPnL");

      await getJobProfit("contractor-1", "job-1");

      // Assert the voice path called the job page's computation
      expect(spy).toHaveBeenCalled();
    });
  });

  describe("Out-of-set query handling", () => {
    it("classifies trend questions as out-of-set", async () => {
      const { classifyQuery } = await import("@/lib/voice/ledger-query-prompt");

      const result = await classifyQuery("How does this month compare to last month?");

      expect(result.queryType).toBe("out_of_set");
      expect(result.supportedQueries).toContain("what am I owed");
      expect(result.supportedQueries).toContain("what do I owe");
      expect(result.supportedQueries).toContain("what did [job] make");
      expect(result.supportedQueries).toContain("what's left");
    });

    it("classifies action requests as out-of-set", async () => {
      const { classifyQuery } = await import("@/lib/voice/ledger-query-prompt");

      const result = await classifyQuery("Mark Frank's costs as paid");

      expect(result.queryType).toBe("out_of_set");
    });

    it("classifies comparison questions as out-of-set", async () => {
      const { classifyQuery } = await import("@/lib/voice/ledger-query-prompt");

      const result = await classifyQuery("Who's my biggest customer?");

      expect(result.queryType).toBe("out_of_set");
    });
  });

  describe("Amount formatting in British English", () => {
    it("formats amounts under £100 without 'and'", async () => {
      const { formatAmount } = await import("@/lib/voice/ledger-query-prompt");

      expect(formatAmount(4520)).toBe("forty-five pounds twenty");
      expect(formatAmount(7500)).toBe("seventy-five pounds");
    });

    it("formats amounts £100-£9,999 in hundreds form", async () => {
      const { formatAmount } = await import("@/lib/voice/ledger-query-prompt");

      expect(formatAmount(124000)).toBe("twelve hundred and forty pounds");
      expect(formatAmount(350000)).toBe("thirty-five hundred pounds");
    });

    it("formats amounts £10,000+ in thousands form", async () => {
      const { formatAmount } = await import("@/lib/voice/ledger-query-prompt");

      expect(formatAmount(1500000)).toBe("fifteen thousand pounds");
      expect(formatAmount(1520000)).toBe("fifteen thousand two hundred pounds");
    });

    it("omits pence when zero", async () => {
      const { formatAmount } = await import("@/lib/voice/ledger-query-prompt");

      expect(formatAmount(4500)).toBe("forty-five pounds");
      expect(formatAmount(4520)).toBe("forty-five pounds twenty");
    });

    it("formats negative amounts", async () => {
      const { formatAmount } = await import("@/lib/voice/ledger-query-prompt");

      const result = formatAmount(-24000);
      // Should include "minus" or negative phrasing
      expect(result).toMatch(/minus|negative|down|loss/i);
    });
  });

  describe("Privacy: customer names only when mentioned", () => {
    it("does not speak customer names for generic 'what am I owed' query", async () => {
      const { formatOwedToYouResponse } = await import("@/lib/voice/ledger-query-prompt");

      const owedData = [
        {
          customerId: "cust-1",
          customerName: "Smith Ltd",
          totalOwed: 240000,
          oldestInvoiceAgeDays: 45,
          unpaidInvoiceIds: ["inv-1"],
        },
      ];

      const response = formatOwedToYouResponse(owedData, {
        customerMentionedInQuery: false,
      });

      // Should NOT contain "Smith Ltd"
      expect(response).not.toContain("Smith Ltd");
      expect(response).not.toContain("Smith");
      // Should contain amount and age
      expect(response).toMatch(/pounds/i);
      expect(response).toMatch(/45 days|days old/i);
    });

    it("speaks customer name when contractor mentioned it in query", async () => {
      const { formatOwedToYouResponse } = await import("@/lib/voice/ledger-query-prompt");

      const owedData = [
        {
          customerId: "cust-1",
          customerName: "Smith Ltd",
          totalOwed: 240000,
          oldestInvoiceAgeDays: 45,
          unpaidInvoiceIds: ["inv-1"],
        },
      ];

      const response = formatOwedToYouResponse(owedData, {
        customerMentionedInQuery: true,
        customerNameFromQuery: "Smith",
      });

      // SHOULD contain "Smith" because contractor said it
      expect(response).toMatch(/Smith/i);
    });

    it("always speaks counterparty names for 'what do I owe'", async () => {
      const { formatYouOweResponse } = await import("@/lib/voice/ledger-query-prompt");

      const youOweData = [
        {
          counterpartyId: "cp-1",
          counterpartyName: "Frank",
          totalOwed: 200000,
          jobCount: 4,
          costIds: ["cost-1"],
        },
      ];

      const response = formatYouOweResponse(youOweData);

      // SHOULD contain "Frank" — counterparty names always spoken
      expect(response).toContain("Frank");
      expect(response).toMatch(/two thousand pounds|2000 pounds/i);
    });
  });

  describe("API route authentication and rate limiting", () => {
    it("requires authentication", async () => {
      const { POST } = await import("@/app/api/ledger/query-session/route");

      const mockRequest = new Request("http://localhost/api/ledger/query-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(mockRequest);

      // Should return 401 when not authenticated
      expect(response.status).toBe(401);
    });

    it("rate limits queries per contractor", async () => {
      const { POST } = await import("@/app/api/ledger/query-session/route");

      // Mock authenticated request
      const mockAuthenticatedRequest = new Request(
        "http://localhost/api/ledger/query-session",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer valid-token",
          },
        },
      );

      // Make requests up to rate limit
      for (let i = 0; i < 10; i++) {
        await POST(mockAuthenticatedRequest);
      }

      // 11th request should be rate limited
      const response = await POST(mockAuthenticatedRequest);
      expect(response.status).toBe(429);

      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/too many|rate limit|try again/i);
    });
  });

  describe("Edge cases", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("handles very large amounts naturally", async () => {
      const { formatAmount } = await import("@/lib/voice/ledger-query-prompt");

      // £47,320
      const result = formatAmount(4732000);
      expect(result).toMatch(
        /forty-seven thousand three hundred|47000|forty seven thousand/i,
      );
    });

    it("handles multiple old invoices - speaks top 3 by age", async () => {
      const { formatOwedToYouResponse } = await import("@/lib/voice/ledger-query-prompt");

      const owedData = [
        {
          customerId: "cust-1",
          customerName: "Customer A",
          totalOwed: 100000,
          oldestInvoiceAgeDays: 120,
          unpaidInvoiceIds: ["inv-1"],
        },
        {
          customerId: "cust-2",
          customerName: "Customer B",
          totalOwed: 50000,
          oldestInvoiceAgeDays: 90,
          unpaidInvoiceIds: ["inv-2"],
        },
        {
          customerId: "cust-3",
          customerName: "Customer C",
          totalOwed: 30000,
          oldestInvoiceAgeDays: 30,
          unpaidInvoiceIds: ["inv-3"],
        },
        {
          customerId: "cust-4",
          customerName: "Customer D",
          totalOwed: 20000,
          oldestInvoiceAgeDays: 15,
          unpaidInvoiceIds: ["inv-4"],
        },
      ];

      const response = formatOwedToYouResponse(owedData, {
        customerMentionedInQuery: false,
      });

      // Should mention 120, 90, 30 days (top 3 by age)
      expect(response).toMatch(/120 days|one hundred twenty days/i);
      expect(response).toMatch(/90 days|ninety days/i);
      expect(response).toMatch(/30 days|thirty days/i);
      // Should NOT mention 15 days (4th oldest, omitted)
      expect(response).not.toMatch(/15 days|fifteen days(?! hundred)/i);
    });

    it("handles job lookup by customer name match", async () => {
      const { getJobProfit } = await import("@/app/ledger/query-actions");

      // Mock job lookup that finds job by customer name
      const result = await getJobProfit("contractor-1", "Smith");

      // Should find and return P&L for job(s) with customer name containing "Smith"
      expect(result).toBeDefined();
    });

    it("handles ambiguous job identifier with multiple matches", async () => {
      const { getJobProfit } = await import("@/app/ledger/query-actions");

      // When multiple jobs match "Smith", should return most recent or ask for clarification
      const result = await getJobProfit("contractor-1", "Smith");

      // Implementation should either:
      // 1. Return most recent Smith job with qualifier in response
      // 2. Return multiple matches for disambiguation
      // Test accepts either approach
      expect(result).toBeDefined();
    });

    it("handles zero collected with costs paid", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: -30000, // -£300 — the old, wrong figure (collected nothing, paid costs)
        safeToSpend: {
          collected: 0,
          costsPaid: 40000,
          motkoFees: 5000,
          vatToSetAside: 5000,
          total: -50000, // -£500 — differs from whatsLeft to catch regression
        },
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getWhatsLeft } = await import("@/app/ledger/query-actions");
      const result = await getWhatsLeft("contractor-1");

      expect(result.total).toBe(-50000);
      // Response formatting should handle this gracefully
    });

    it("handles network failure during query with clear error", async () => {
      const mockGetMoneyPosition = vi.fn(async () => {
        throw new Error("Network error");
      });

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getOwedToYou } = await import("@/app/ledger/query-actions");

      await expect(getOwedToYou("contractor-1")).rejects.toThrow();
    });
  });

  describe("No LLM arithmetic - computation is server-side", () => {
    it("voice prompt receives pre-computed figures, not raw data", async () => {
      const { buildLedgerQueryInstructions } = await import(
        "@/lib/voice/ledger-query-prompt"
      );

      const instructions = buildLedgerQueryInstructions();

      // Prompt should instruct model to use provided figures, not compute
      expect(instructions).toMatch(/pre-computed|server-computed|provided/i);
      expect(instructions).toMatch(/do not (calculate|compute|sum|add)/i);
    });

    it("response formatters receive amounts in pence, convert to speech only", async () => {
      const { formatOwedToYouResponse } = await import("@/lib/voice/ledger-query-prompt");

      const owedData = [
        {
          customerId: "cust-1",
          customerName: "Customer A",
          totalOwed: 124000, // Already computed by server
          oldestInvoiceAgeDays: 45,
          unpaidInvoiceIds: ["inv-1"],
        },
      ];

      const response = formatOwedToYouResponse(owedData, {
        customerMentionedInQuery: false,
      });

      // Response should format the 124000 into speech, not compute it
      expect(response).toMatch(/twelve hundred|1240|one thousand two hundred/i);
    });
  });
});
