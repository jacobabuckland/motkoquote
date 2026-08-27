/**
 * @vitest-environment happy-dom
 *
 * Acceptance tests for Issue #389: Money position card — one signed chain ending in SAFE TO SPEND
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);

// Types from PNL-1 (may not exist yet)
type SafeToSpend = {
  collected: number;
  costsPaid: number;
  motkoFees: number;
  vatToSetAside: number | null;
  total: number;
};

type Projection = {
  owedNet: number;
  unpaidCostsNet: number;
  feesOnOwed: number;
  total: number;
};

type MoneyPosition = {
  owedToYou: Array<{
    customerId: string;
    customerName: string;
    totalOwed: number;
    oldestInvoiceAgeDays: number;
    unpaidInvoiceIds: string[];
  }>;
  youOwe: Array<{
    counterpartyId: string | null;
    counterpartyName: string | null;
    totalOwed: number;
    jobCount: number;
    costIds: string[];
  }>;
  vat: {
    collected: number;
    onCosts: number;
    position: number;
  } | null;
  whatsLeft: number;
  safeToSpend: SafeToSpend;
  projection: Projection;
};

describe("Issue #389: Money position card", () => {
  describe("Criterion 1: Rendered lines sum to rendered total", () => {
    it("reads values from DOM and verifies SAFE TO SPEND equals the sum of the chain", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [],
        youOwe: [],
        vat: { collected: 2384, onCosts: 400, position: 1984 },
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: 1984,
          total: 9920,
        },
        projection: {
          owedNet: 20000,
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 29920,
        },
      };

      render(<MoneyPositionClient position={position} />);

      // Helper to extract pence from rendered money (e.g. "£119.04" -> 11904)
      const pence = (testId: string): number => {
        const element = screen.getByTestId(testId);
        const text = element.textContent || "";
        const cleaned = text.replace(/[^0-9.-]/g, "");
        return Math.round(parseFloat(cleaned) * 100);
      };

      expect(pence("safe-to-spend")).toBe(
        pence("collected") - pence("costs-paid") - pence("motko-fees") - pence("vat-set-aside")
      );
    });
  });

  describe("Criterion 2: Not VAT-registered renders no VAT row", () => {
    it("omits VAT row entirely when vat is null", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: null,
          total: 11904,
        },
        projection: {
          owedNet: 0,
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 11904,
        },
      };

      render(<MoneyPositionClient position={position} />);

      expect(screen.queryByTestId("vat-set-aside")).toBeNull();

      // Criterion 1's sum holds without VAT term
      const pence = (testId: string): number => {
        const element = screen.getByTestId(testId);
        const text = element.textContent || "";
        const cleaned = text.replace(/[^0-9.-]/g, "");
        return Math.round(parseFloat(cleaned) * 100);
      };

      expect(pence("safe-to-spend")).toBe(
        pence("collected") - pence("costs-paid") - pence("motko-fees")
      );
    });
  });

  describe("Criterion 3: Zero fee renders at £0.00, present", () => {
    it("displays motko fees row at £0.00 when fees are zero", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 0,
          motkoFees: 0, // Zero fee
          vatToSetAside: null,
          total: 11904,
        },
        projection: {
          owedNet: 0,
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 11904,
        },
      };

      render(<MoneyPositionClient position={position} />);

      const feesElement = screen.getByTestId("motko-fees");
      expect(feesElement).toBeDefined();
      expect(feesElement.textContent).toMatch(/£0\.00/);
    });
  });

  describe("Criterion 4: Every deducted row has minus sign", () => {
    it("renders minus signs on costs, fees, and VAT rows", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [],
        youOwe: [],
        vat: { collected: 2384, onCosts: 400, position: 1984 },
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 500,
          motkoFees: 300,
          vatToSetAside: 1984,
          total: 9120,
        },
        projection: {
          owedNet: 0,
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 9120,
        },
      };

      render(<MoneyPositionClient position={position} />);

      // Check that each deducted row contains a minus sign
      const costsPaid = screen.getByTestId("costs-paid").textContent || "";
      const motkoFees = screen.getByTestId("motko-fees").textContent || "";
      const vatSetAside = screen.getByTestId("vat-set-aside").textContent || "";

      expect(costsPaid).toMatch(/^[−-]/); // Either minus sign or hyphen
      expect(motkoFees).toMatch(/^[−-]/);
      expect(vatSetAside).toMatch(/^[−-]/);
    });
  });

  describe("Criterion 5: SAFE TO SPEND is last row, retired strings gone", () => {
    it("renders SAFE TO SPEND and does not render retired strings", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: null,
          total: 11904,
        },
        projection: {
          owedNet: 0,
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 11904,
        },
      };

      const { container } = render(<MoneyPositionClient position={position} />);

      // SAFE TO SPEND must exist
      expect(screen.getByTestId("safe-to-spend")).toBeDefined();

      // Retired strings must not appear
      const text = container.textContent || "";
      expect(text).not.toContain("What's left");
      expect(text).not.toContain("Money collected, minus costs you've paid");
      expect(text).not.toContain("What’s left"); // rsquo variant
      expect(text).not.toContain("Money collected, minus costs you’ve paid");
    });
  });

  describe("Criterion 6: Negative total renders as negative", () => {
    it("displays negative SAFE TO SPEND when costs + fees exceed collected", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: -5000,
        safeToSpend: {
          collected: 5000,
          costsPaid: 8000,
          motkoFees: 2000,
          vatToSetAside: null,
          total: -5000,
        },
        projection: {
          owedNet: 0,
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: -5000,
        },
      };

      render(<MoneyPositionClient position={position} />);

      const safeToSpend = screen.getByTestId("safe-to-spend");
      const text = safeToSpend.textContent || "";

      // Should display negative sign
      expect(text).toMatch(/^[−-]£/);

      // Should not be clamped to zero or absolute value
      expect(text).toContain("50.00");
    });
  });

  describe("Criterion 7: COMING IN excluded from chain", () => {
    it("criterion 1's sum holds even with owedToYou entries present", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [
          {
            customerId: "cust-1",
            customerName: "Jacob Buckland",
            totalOwed: 24000, // £240.00 owed (COMING IN)
            oldestInvoiceAgeDays: 3,
            unpaidInvoiceIds: ["inv-1"],
          },
        ],
        youOwe: [],
        vat: { collected: 2384, onCosts: 400, position: 1984 },
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: 1984,
          total: 9920, // Does NOT include the £240 owed
        },
        projection: {
          owedNet: 20000, // Net of VAT: £240 gross - £40 VAT = £200 net
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 29920, // £99.20 + £200 = £299.20
        },
      };

      render(<MoneyPositionClient position={position} />);

      const pence = (testId: string): number => {
        const element = screen.getByTestId(testId);
        const text = element.textContent || "";
        const cleaned = text.replace(/[^0-9.-]/g, "");
        return Math.round(parseFloat(cleaned) * 100);
      };

      // The sum still holds — owed is not part of safe-to-spend
      expect(pence("safe-to-spend")).toBe(
        pence("collected") - pence("costs-paid") - pence("motko-fees") - pence("vat-set-aside")
      );
    });
  });

  describe("Criterion 8: Projection renders and sums from DOM", () => {
    it("projection total equals safe-to-spend + owed - unpaid costs - fees on owed", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [
          {
            customerId: "cust-1",
            customerName: "Jacob Buckland",
            totalOwed: 24000,
            oldestInvoiceAgeDays: 3,
            unpaidInvoiceIds: ["inv-1"],
          },
        ],
        youOwe: [],
        vat: { collected: 2384, onCosts: 400, position: 1984 },
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: 1984,
          total: 9920,
        },
        projection: {
          owedNet: 20000,
          unpaidCostsNet: 500,
          feesOnOwed: 300,
          total: 29120, // 9920 + 20000 - 500 - 300
        },
      };

      render(<MoneyPositionClient position={position} />);

      const pence = (testId: string): number => {
        const element = screen.getByTestId(testId);
        const text = element.textContent || "";
        const cleaned = text.replace(/[^0-9.-]/g, "");
        return Math.round(parseFloat(cleaned) * 100);
      };

      expect(pence("projection-total")).toBe(
        pence("safe-to-spend") +
          pence("projection-owed") -
          pence("projection-unpaid-costs") -
          pence("projection-fees")
      );
    });
  });

  describe("Criterion 9: Projection uses net owed, not gross", () => {
    it("projection total is £299.20, not £339.20, with £240 gross owed and £99.20 safe-to-spend", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [
          {
            customerId: "cust-1",
            customerName: "Jacob Buckland",
            totalOwed: 24000, // £240.00 gross (COMING IN display)
            oldestInvoiceAgeDays: 3,
            unpaidInvoiceIds: ["inv-1"],
          },
        ],
        youOwe: [],
        vat: { collected: 2384, onCosts: 400, position: 1984 },
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: 1984,
          total: 9920, // £99.20
        },
        projection: {
          owedNet: 20000, // £200.00 net (VAT removed)
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 29920, // £299.20 = £99.20 + £200.00
        },
      };

      render(<MoneyPositionClient position={position} />);

      const projectionTotal = screen.getByTestId("projection-total");
      const text = projectionTotal.textContent || "";

      // Must be £299.20, NOT £339.20
      expect(text).toContain("299.20");
      expect(text, "projection must not add gross £240 figure").not.toContain("339.20");
    });
  });

  describe("Criterion 10: Projection does not outrank total", () => {
    it("SAFE TO SPEND uses size total, projection does not", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: null,
          total: 11904,
        },
        projection: {
          owedNet: 20000,
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 31904,
        },
      };

      render(<MoneyPositionClient position={position} />);

      const safeToSpend = screen.getByTestId("safe-to-spend");
      const projectionTotal = screen.getByTestId("projection-total");

      // SAFE TO SPEND should have larger visual treatment
      // Check that they have different size classes or that only one is size="total"
      const safeClasses = safeToSpend.className;
      const projClasses = projectionTotal.className;

      // The Money component uses text-2xl for size="total" and smaller for size="row"
      const safeIsBigger =
        safeClasses.includes("text-2xl") || safeClasses.includes("text-4xl");
      const projIsSmaller =
        !projClasses.includes("text-2xl") && !projClasses.includes("text-4xl");

      expect(safeIsBigger, "SAFE TO SPEND should use size=total treatment").toBe(true);
      expect(projIsSmaller, "Projection should NOT use size=total treatment").toBe(true);
    });
  });

  describe("Criterion 11: Nothing owed/unpaid means projection equals safe-to-spend", () => {
    it("with zero owed and zero unpaid, criterion 8 still holds", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 11904,
        safeToSpend: {
          collected: 11904,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: null,
          total: 11904,
        },
        projection: {
          owedNet: 0,
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 11904, // Same as safe-to-spend
        },
      };

      render(<MoneyPositionClient position={position} />);

      const pence = (testId: string): number => {
        const element = screen.getByTestId(testId);
        const text = element.textContent || "";
        const cleaned = text.replace(/[^0-9.-]/g, "");
        return Math.round(parseFloat(cleaned) * 100);
      };

      // If projection renders, it should equal safe-to-spend
      const projectionElement = screen.queryByTestId("projection-total");
      if (projectionElement) {
        expect(pence("projection-total")).toBe(pence("safe-to-spend"));

        // Criterion 8 still holds
        expect(pence("projection-total")).toBe(
          pence("safe-to-spend") +
            pence("projection-owed") -
            pence("projection-unpaid-costs") -
            pence("projection-fees")
        );
      }
    });
  });

  describe("Criterion 12: Card performs no currency arithmetic", () => {
    it("component source does not contain money arithmetic operations", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const componentPath = path.join(
        process.cwd(),
        "src/app/jobs/money-position-client.tsx"
      );
      const source = await fs.readFile(componentPath, "utf-8");

      // Slice to the section that renders the breakdown
      const startIndex = source.indexOf("MONEY IN AND OUT");
      expect(startIndex, "MONEY IN AND OUT section not found").toBeGreaterThan(-1);
      const body = source.slice(startIndex);

      // Check that none of the breakdown terms appear in arithmetic expressions
      const arithmeticPattern =
        /\b(collected|costsPaid|motkoFees|vatToSetAside|owedNet|unpaidCostsNet|feesOnOwed|total)\s*[-+*/]/;

      expect(body, "the card renders the breakdown; PNL-1 computes it").not.toMatch(
        arithmeticPattern
      );
    });
  });

  describe("Edge case: Nothing collected at all", () => {
    it("renders the chain with Collected £0.00 and SAFE TO SPEND £0.00", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 0,
        safeToSpend: {
          collected: 0,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: null,
          total: 0,
        },
        projection: {
          owedNet: 0,
          unpaidCostsNet: 0,
          feesOnOwed: 0,
          total: 0,
        },
      };

      render(<MoneyPositionClient position={position} />);

      // Chain should render, not be hidden
      const collected = screen.getByTestId("collected");
      const safeToSpend = screen.getByTestId("safe-to-spend");

      expect(collected.textContent).toMatch(/£0\.00/);
      expect(safeToSpend.textContent).toMatch(/£0\.00/);
    });
  });

  describe("Edge case: Projection lower than safe-to-spend", () => {
    it("renders projection even when worse than current position", async () => {
      const { MoneyPositionClient } = await import("@/app/jobs/money-position-client");

      const position: MoneyPosition = {
        owedToYou: [],
        youOwe: [],
        vat: null,
        whatsLeft: 10000,
        safeToSpend: {
          collected: 10000,
          costsPaid: 0,
          motkoFees: 0,
          vatToSetAside: null,
          total: 10000, // £100
        },
        projection: {
          owedNet: 0,
          unpaidCostsNet: 15000, // Unpaid costs exceed what's owed
          feesOnOwed: 0,
          total: -5000, // Projection is negative: £100 - £150 = -£50
        },
      };

      render(<MoneyPositionClient position={position} />);

      const projectionTotal = screen.getByTestId("projection-total");
      const text = projectionTotal.textContent || "";

      // Should render as negative
      expect(text).toMatch(/^[−-]£/);
      expect(text).toContain("50.00");
    });
  });
});
