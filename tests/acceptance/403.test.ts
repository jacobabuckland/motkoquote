import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Issue #403: PNL-4 — Voice "What's left?" must name what came off
 *
 * CRITICAL: ALL money values in this file are INTEGER PENCE.
 * - 9920 pence = £99.20 (NOT £99.20 pence)
 * - 1984 pence = £19.84 (NOT £19.84 pence)
 * - 500 pence = £5.00 (NOT £5.00 pence)
 *
 * A previous derivation died because fixtures used pounds in pence fields.
 * The acceptance tests are frozen after this commit, so a mistake here
 * blocks the item permanently.
 */

describe("Issue #403: Voice What's left must name what came off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("getWhatsLeft returns structured breakdown", () => {
    it("returns WhatsLeftAnswer with total, costsPaid, motkoFees, vatToSetAside", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [],
        vat: { collected: 0, onCosts: 0, toSetAside: 1984 },
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: 1984,
          total: 9920, // £99.20
        },
        projection: { owedNet: 0, unpaidCostsNet: 0, feesOnOwed: 0, total: 9920 },
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getWhatsLeft } = await import("@/app/ledger/query-actions");
      const result = await getWhatsLeft("contractor-test");

      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("costsPaid");
      expect(result).toHaveProperty("motkoFees");
      expect(result).toHaveProperty("vatToSetAside");
      expect(typeof result.total).toBe("number");
      expect(typeof result.costsPaid).toBe("number");
      expect(typeof result.motkoFees).toBe("number");
      expect(result.vatToSetAside === null || typeof result.vatToSetAside === "number").toBe(true);
    });

    it("delegates to getMoneyPosition and extracts safeToSpend breakdown", async () => {
      const mockGetMoneyPosition = vi.fn(async () => ({
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 0,
        safeToSpend: {
          collected: 50000,
          costsPaid: 20000,
          motkoFees: 500,
          vatToSetAside: null,
          total: 29500,
        },
        projection: { owedNet: 0, unpaidCostsNet: 0, feesOnOwed: 0, total: 29500 },
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getWhatsLeft } = await import("@/app/ledger/query-actions");
      const result = await getWhatsLeft("contractor-test");

      expect(mockGetMoneyPosition).toHaveBeenCalledWith("contractor-test");
      expect(result.total).toBe(29500);
      expect(result.costsPaid).toBe(20000);
      expect(result.motkoFees).toBe(500);
      expect(result.vatToSetAside).toBe(null);
    });
  });

  describe("formatWhatsLeftResponse spoken sentence", () => {
    it("speaks the safe-to-spend total, not collected minus costs", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // Fixture: total 9920 (£99.20) from collected 11904 (£119.04), no costs, no fees, VAT-registered
      const answer = {
        total: 9920, // £99.20 in pence
        costsPaid: 0,
        motkoFees: 0,
        vatToSetAside: 1984, // £19.84 in pence
      };

      const spoken = formatWhatsLeftResponse(answer);

      // Must speak £99.20, the safe-to-spend total
      expect(spoken).toMatch(/99|ninety[- ]nine/i);
      expect(spoken).toMatch(/20|twenty/i);

      // Must NOT speak £119.04, the collected figure
      expect(spoken).not.toMatch(/119|one hundred.*nineteen/i);
    });

    it("names VAT with amount when there is VAT to set aside", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const answer = {
        total: 7936, // £79.36 in pence (some total after deductions)
        costsPaid: 0,
        motkoFees: 0,
        vatToSetAside: 1984, // £19.84 in pence
      };

      const spoken = formatWhatsLeftResponse(answer);

      // Must mention VAT
      expect(spoken).toMatch(/VAT/i);

      // Must speak the VAT amount £19.84
      expect(spoken).toMatch(/19|nineteen/i);
      expect(spoken).toMatch(/84|eighty[- ]four/i);
    });

    it("never mentions VAT when not VAT-registered", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const answer = {
        total: 9920, // £99.20 in pence
        costsPaid: 0,
        motkoFees: 0,
        vatToSetAside: null, // Not VAT-registered
      };

      const spoken = formatWhatsLeftResponse(answer);

      // Must NOT mention VAT at all
      expect(spoken).not.toMatch(/VAT/i);
    });

    it("omits zero terms from the deductions list", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // No costs, no fees, not registered → sentence names no deductions
      const answer = {
        total: 11904, // £119.04 in pence
        costsPaid: 0,
        motkoFees: 0,
        vatToSetAside: null,
      };

      const spoken = formatWhatsLeftResponse(answer);

      // Must still state the total
      expect(spoken).toMatch(/119|one hundred.*nineteen/i);

      // Should not list zero deductions (no "after" clause listing zeros)
      // The sentence should collapse to just the total with no deduction list
      expect(spoken).toMatch(/safe to spend/i);
    });

    it("names fees with the AMOUNT when a fee was collected", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const answer = {
        total: 9420, // £94.20 in pence (after £5 fee)
        costsPaid: 0,
        motkoFees: 500, // £5.00 in pence
        vatToSetAside: null,
      };

      const spoken = formatWhatsLeftResponse(answer);

      // Must mention motko's fees
      expect(spoken).toMatch(/motko|fee/i);

      // Must speak the fee amount £5.00
      // Accept "five pounds" or "five" in the context of fees
      expect(spoken).toMatch(/5|five/i);
      expect(spoken).toMatch(/pound/i);
    });

    it("speaks negative total as a shortfall with readable wording", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const answer = {
        total: -5000, // -£50.00 in pence
        costsPaid: 6000,
        motkoFees: 0,
        vatToSetAside: null,
      };

      const spoken = formatWhatsLeftResponse(answer);

      // Must indicate a shortfall / deficit, not "You've got minus fifty pounds safe to spend"
      expect(spoken).toMatch(/down|short|minus|negative|owe|deficit/i);

      // Must speak the amount £50
      expect(spoken).toMatch(/50|fifty/i);

      // Should NOT use the phrase "safe to spend" for a negative (that's illogical)
      if (spoken.toLowerCase().includes("safe to spend")) {
        expect(spoken).toMatch(/-|minus|negative/i); // If it does, it better be clearly negative
      }
    });

    it("handles total exactly zero with natural phrasing", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const answer = {
        total: 0,
        costsPaid: 10000,
        motkoFees: 0,
        vatToSetAside: null,
      };

      const spoken = formatWhatsLeftResponse(answer);

      // Should say "nothing left" rather than "£0.00 safe to spend"
      expect(spoken).toMatch(/nothing|zero/i);
    });

    it("does not use the old sentence 'after paying your costs'", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const answer = {
        total: 9920, // £99.20 in pence
        costsPaid: 1000,
        motkoFees: 500,
        vatToSetAside: 1984,
      };

      const spoken = formatWhatsLeftResponse(answer);

      // The old phrasing must be gone
      expect(spoken).not.toMatch(/after paying your costs/i);
    });

    it("names ALL non-zero deductions with amounts", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const answer = {
        total: 5436, // £54.36 in pence (after all deductions)
        costsPaid: 3000, // £30.00
        motkoFees: 500, // £5.00
        vatToSetAside: 1984, // £19.84
      };

      const spoken = formatWhatsLeftResponse(answer);

      // Must name costs with amount
      expect(spoken).toMatch(/cost/i);
      expect(spoken).toMatch(/30|thirty/i);

      // Must name fees with amount
      expect(spoken).toMatch(/fee/i);
      expect(spoken).toMatch(/5|five/i);

      // Must name VAT with amount
      expect(spoken).toMatch(/VAT/i);
      expect(spoken).toMatch(/19|nineteen/i);
      expect(spoken).toMatch(/84|eighty[- ]four/i);
    });
  });

  describe("Integration: getWhatsLeft delegates to PNL-1's getMoneyPosition", () => {
    it("returns the same total as safeToSpend.total from getMoneyPosition", async () => {
      const mockGetMoneyPosition = vi.fn(async (_contractorId?: string) => ({
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 15000, // Old figure, deliberately different
        safeToSpend: {
          collected: 20000,
          costsPaid: 3000,
          motkoFees: 500,
          vatToSetAside: null,
          total: 16500, // This is what getWhatsLeft should return
        },
        projection: { owedNet: 0, unpaidCostsNet: 0, feesOnOwed: 0, total: 16500 },
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getWhatsLeft } = await import("@/app/ledger/query-actions");
      const whatsLeftResult = await getWhatsLeft("contractor-test");

      // getWhatsLeft.total must equal getMoneyPosition().safeToSpend.total
      // Compare by calling both, not against a hardcoded number
      const positionResult = await mockGetMoneyPosition("contractor-test");
      expect(whatsLeftResult.total).toBe(positionResult.safeToSpend.total);

      // And they must differ from the old whatsLeft figure to prove the migration happened
      expect(whatsLeftResult.total).not.toBe(positionResult.whatsLeft);
    });
  });

  describe("Prompt strings agree with new behaviour", () => {
    it("get_whats_left tool description no longer says 'collected minus costs paid'", async () => {
      const { LEDGER_QUERY_TOOLS } = await import("@/lib/voice/ledger-query-prompt");

      const whatsLeftTool = LEDGER_QUERY_TOOLS.find((t) => t.name === "get_whats_left");
      expect(whatsLeftTool).toBeDefined();

      const description = whatsLeftTool?.description ?? "";

      // Must NOT say "collected minus costs paid"
      expect(description).not.toMatch(/collected minus.*costs? paid/i);
      expect(description).not.toMatch(/collected.*minus.*paid/i);
    });

    it("supported queries list no longer says 'collected minus paid costs'", async () => {
      const { buildLedgerQueryInstructions } = await import("@/lib/voice/ledger-query-prompt");

      const instructions = buildLedgerQueryInstructions();

      // Find the "What's left?" line in the supported queries section
      const lines = instructions.split("\n");
      const whatsLeftLine = lines.find((line) => line.match(/5\.\s*What'?s left/i));

      expect(whatsLeftLine).toBeDefined();

      // Must NOT say "collected minus paid costs"
      expect(whatsLeftLine).not.toMatch(/collected minus.*paid costs?/i);
      expect(whatsLeftLine).not.toMatch(/collected.*minus.*costs?/i);
    });
  });

  describe("formatWhatsLeftResponse is exported for testing", () => {
    it("exports formatWhatsLeftResponse from ledger-query-prompt", async () => {
      const mod = await import("@/lib/voice/ledger-query-prompt");

      expect(mod.formatWhatsLeftResponse).toBeDefined();
      expect(typeof mod.formatWhatsLeftResponse).toBe("function");
    });
  });

  describe("Edge case: values from the spec table", () => {
    it("handles the exact fixture values from the issue spec", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // From the spec: total 9920, VAT 1984, fee 500
      const answer = {
        total: 9920, // £99.20 in pence
        costsPaid: 0,
        motkoFees: 500, // £5.00 in pence
        vatToSetAside: 1984, // £19.84 in pence
      };

      const spoken = formatWhatsLeftResponse(answer);

      // The sentence must be coherent and mention all three non-zero terms
      expect(spoken).toMatch(/99|ninety[- ]nine/i); // £99.20 total
      expect(spoken).toMatch(/5|five/i); // £5.00 fee
      expect(spoken).toMatch(/19|nineteen/i); // £19.84 VAT
      expect(spoken).toMatch(/VAT/i);
      expect(spoken).toMatch(/fee/i);
    });
  });
});
