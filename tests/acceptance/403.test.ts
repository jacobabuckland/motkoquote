import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Issue #403: PNL-4 Voice 'What's left?' must name what came off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("formatWhatsLeftResponse", () => {
    it("speaks the safe-to-spend total, not collected minus costs", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // total: 9920 pence = £99.20
      // collected would be 11904 pence = £119.04 (but we never speak this)
      // Verify the sentence speaks £99.20 and does NOT speak £119.04
      const result = formatWhatsLeftResponse({
        total: 9920,
        costsPaid: 0,
        motkoFees: 0,
        vatToSetAside: 1984,
      });

      // Must speak the total (£99.20)
      expect(result).toMatch(/ninety-nine.*twenty|99.*20/i);
      // Must NOT speak the old collected figure (£119.04)
      expect(result).not.toMatch(/119|one hundred.*nineteen|hundred.*nineteen/i);
    });

    it("names VAT when there is VAT", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // vatToSetAside: 1984 pence = £19.84
      const result = formatWhatsLeftResponse({
        total: 9920,
        costsPaid: 0,
        motkoFees: 0,
        vatToSetAside: 1984,
      });

      // Must mention VAT
      expect(result).toMatch(/VAT/i);
      // Must speak the VAT amount (£19.84)
      expect(result).toMatch(/nineteen.*eighty-four|19.*84/i);
    });

    it("never mentions VAT when not registered", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // vatToSetAside: null = not VAT-registered
      const result = formatWhatsLeftResponse({
        total: 11904,
        costsPaid: 0,
        motkoFees: 0,
        vatToSetAside: null,
      });

      // Must NOT mention VAT at all
      expect(result).not.toMatch(/VAT/i);
    });

    it("omits zero terms", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // No costs, no fees, not registered → names no deductions
      const result = formatWhatsLeftResponse({
        total: 11904,
        costsPaid: 0,
        motkoFees: 0,
        vatToSetAside: null,
      });

      // Should still state the total
      expect(result).toMatch(/119|one hundred.*nineteen/i);
      // Should NOT mention any deductions
      expect(result).not.toMatch(/after|costs|fees|VAT/i);
    });

    it("names fees when a fee was collected, with the amount", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // motkoFees: 500 pence = £5.00
      const result = formatWhatsLeftResponse({
        total: 9920,
        costsPaid: 0,
        motkoFees: 500,
        vatToSetAside: null,
      });

      // Must mention motko or fees
      expect(result).toMatch(/motko|fees/i);
      // Must speak the fee amount (£5.00)
      expect(result).toMatch(/five pounds|five pound|\b5\b/i);
    });

    it("negative total speaks as a shortfall", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // total: -5000 pence = -£50.00
      const result = formatWhatsLeftResponse({
        total: -5000,
        costsPaid: 3000,
        motkoFees: 500,
        vatToSetAside: null,
      });

      // Must indicate a shortfall or negative state
      expect(result).toMatch(/down|minus|owe|short|negative/i);
      // Must speak the magnitude (£50.00)
      expect(result).toMatch(/fifty|50/i);
    });

    it("the old sentence is gone", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const result = formatWhatsLeftResponse({
        total: 9920,
        costsPaid: 1000,
        motkoFees: 500,
        vatToSetAside: null,
      });

      // Must NOT contain the old pattern "after paying your costs"
      expect(result).not.toMatch(/after paying your costs/i);
    });

    it("handles exactly zero total", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const result = formatWhatsLeftResponse({
        total: 0,
        costsPaid: 10000,
        motkoFees: 500,
        vatToSetAside: null,
      });

      // Should say something like "nothing left to spend" not "£0.00"
      expect(result).toMatch(/nothing|zero|none/i);
    });

    it("names multiple non-zero deductions with their amounts", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // All three deductions present and non-zero
      // costsPaid: 5000 = £50.00
      // motkoFees: 500 = £5.00
      // vatToSetAside: 1984 = £19.84
      const result = formatWhatsLeftResponse({
        total: 3000,
        costsPaid: 5000,
        motkoFees: 500,
        vatToSetAside: 1984,
      });

      // Must mention costs
      expect(result).toMatch(/costs/i);
      // Must mention fees with amount
      expect(result).toMatch(/motko|fees/i);
      expect(result).toMatch(/five pounds|five pound|\b5\b/i);
      // Must mention VAT with amount
      expect(result).toMatch(/VAT/i);
      expect(result).toMatch(/nineteen.*eighty-four|19.*84/i);
    });
  });

  describe("getWhatsLeft returns PNL-1's total", () => {
    it("returns safeToSpend.total from getMoneyPosition", async () => {
      // Mock getMoneyPosition to return a known safeToSpend
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const mockGetMoneyPosition = vi.fn(async (_contractorId?: string) => ({
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 350000, // old field (collected - costs)
        safeToSpend: {
          collected: 500000,
          costsPaid: 150000,
          motkoFees: 10000,
          vatToSetAside: 20000,
          total: 320000, // collected - costs - fees - VAT
        },
        projection: {
          owedNet: 0,
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 0,
        },
      }));

      vi.doMock("@/app/jobs/money-position-actions", () => ({
        getMoneyPosition: mockGetMoneyPosition,
      }));

      const { getWhatsLeft } = await import("@/app/ledger/query-actions");
      const result = await getWhatsLeft("contractor-1");

      // Must return the breakdown with safeToSpend.total
      expect(result.total).toBe(320000);
      expect(result.costsPaid).toBe(150000);
      expect(result.motkoFees).toBe(10000);
      expect(result.vatToSetAside).toBe(20000);

      // Verify it differs from whatsLeft (proving we're using the new field)
      expect(result.total).not.toBe(350000);
    });
  });

  describe("Prompt strings match the new behaviour", () => {
    it("tool description at :90 describes safe-to-spend, not collected minus costs", async () => {
      const { LEDGER_QUERY_TOOLS } = await import("@/lib/voice/ledger-query-prompt");

      const whatsLeftTool = LEDGER_QUERY_TOOLS.find((t) => t.name === "get_whats_left");
      expect(whatsLeftTool).toBeDefined();

      // Must NOT describe the old behaviour
      expect(whatsLeftTool?.description).not.toMatch(/collected minus costs|collected.*costs/i);
      // Must describe deductions (costs, fees, VAT)
      expect(whatsLeftTool?.description).toMatch(/safe.*spend|after.*deduct/i);
    });

    it("supported query list at :156 describes safe-to-spend, not collected minus costs", async () => {
      const { buildLedgerQueryInstructions } = await import(
        "@/lib/voice/ledger-query-prompt"
      );

      const instructions = buildLedgerQueryInstructions();

      // The instructions include the supported queries section
      // Must NOT describe "collected minus paid costs"
      expect(instructions).not.toMatch(/collected minus.*costs|collected.*minus.*paid/i);
      // Must describe safe-to-spend or deductions
      expect(instructions).toMatch(/safe.*spend|after.*all deductions/i);
    });
  });

  describe("Edge cases: composition under various states", () => {
    it("handles costs but no fees or VAT", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const result = formatWhatsLeftResponse({
        total: 5000,
        costsPaid: 3000,
        motkoFees: 0,
        vatToSetAside: null,
      });

      // Must mention costs (non-zero)
      expect(result).toMatch(/costs/i);
      // Must NOT mention fees or VAT (zero / null)
      expect(result).not.toMatch(/motko|fees/i);
      expect(result).not.toMatch(/VAT/i);
    });

    it("handles fees but no costs", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      const result = formatWhatsLeftResponse({
        total: 9500,
        costsPaid: 0,
        motkoFees: 500,
        vatToSetAside: null,
      });

      // Must mention fees
      expect(result).toMatch(/motko|fees/i);
      // Must NOT mention costs (zero)
      expect(result).not.toMatch(/costs/i);
    });

    it("handles large negative total", async () => {
      const { formatWhatsLeftResponse } = await import("@/lib/voice/ledger-query-prompt");

      // total: -125000 pence = -£1,250.00
      const result = formatWhatsLeftResponse({
        total: -125000,
        costsPaid: 100000,
        motkoFees: 5000,
        vatToSetAside: 20000,
      });

      // Must indicate shortfall
      expect(result).toMatch(/down|minus|owe|short/i);
      // Must speak the magnitude (£1,250)
      expect(result).toMatch(/twelve hundred.*fifty|1250|one thousand two hundred/i);
    });
  });
});
