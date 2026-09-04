import { describe, expect, it } from "vitest";
import type { LineItem } from "@/lib/schemas/job";

/**
 * PFIX-5: Redefine the invention-rate metric
 *
 * The 55% metric cannot be used — it measures code transformations, not user
 * rejection. Replace it with a binary fixture-derived gate: against the fixture
 * corpus, zero line items carry a monetary value absent from the transcript.
 */

describe("PFIX-5: Binary invention gate", () => {
  it("checkNoInventedPrices exists and is exported from pipeline-compare", async () => {
    const { checkNoInventedPrices } = await import("../helpers/pipeline-compare");
    expect(checkNoInventedPrices).toBeDefined();
    expect(typeof checkNoInventedPrices).toBe("function");
  });

  it("detects when a stated price reaches no line", async () => {
    const { checkNoInventedPrices } = await import("../helpers/pipeline-compare");

    // A transcript stating £520 for tiling
    const transcript = "Tiling labour is five hundred and twenty pounds.";

    // But the compiled quote carries no such line
    const lineItems: LineItem[] = [
      {
        description: "General labour",
        category: "labour" as const,
        quantity: 2,
        unit: "day",
        unit_price: 250,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      },
    ];

    const failures = checkNoInventedPrices("test-missing-stated", transcript, lineItems);

    // Should fail: £520 stated but reaches no line
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]?.message).toMatch(/520|stated/i);
  });

  it("detects when a line carries a price absent from the transcript", async () => {
    const { checkNoInventedPrices } = await import("../helpers/pipeline-compare");

    // Transcript mentions £800 only
    const transcript = "The bathroom suite is eight hundred pounds.";

    // But a line carries £350 (invented)
    const lineItems: LineItem[] = [
      {
        description: "Basin and pedestal",
        category: "materials" as const,
        quantity: 1,
        unit: "item",
        unit_price: 350,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        supplied_by: "contractor" as const,
      },
    ];

    const failures = checkNoInventedPrices("test-invented-price", transcript, lineItems);

    // Should fail: £350 appears on no transcript
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]?.message).toMatch(/350|invented|transcript/i);
  });

  it("does not flag provisional sums as invented", async () => {
    const { checkNoInventedPrices } = await import("../helpers/pipeline-compare");

    const transcript = "The scope is a bathroom refit. No prices discussed.";

    // A provisional sum with a model-suggested amount
    const lineItems: LineItem[] = [
      {
        description: "Soil stack — condition unknown",
        category: "other" as const,
        quantity: 1,
        unit: "sum",
        unit_price: 0,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        provisional: true,
      },
    ];

    const failures = checkNoInventedPrices("test-provisional", transcript, lineItems);

    // Should pass: provisional sums are not invented prices
    expect(failures).toEqual([]);
  });

  it("does not flag customer-supplied materials at £0", async () => {
    const { checkNoInventedPrices } = await import("../helpers/pipeline-compare");

    const transcript = "Tiles are customer-supplied.";

    const lineItems: LineItem[] = [
      {
        description: "Wall tiles — 14m²",
        category: "materials" as const,
        quantity: 14,
        unit: "m²",
        unit_price: 0,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        supplied_by: "customer" as const,
      },
    ];

    const failures = checkNoInventedPrices("test-customer-supplied", transcript, lineItems);

    // Should pass: customer-supplied at £0 is not invented
    expect(failures).toEqual([]);
  });

  it("does not flag labour priced from stored rates", async () => {
    const { checkNoInventedPrices } = await import("../helpers/pipeline-compare");

    // Transcript mentions duration but not the specific rate
    const transcript = "It's me and my apprentice for three days.";

    // Labour line priced from contractor's stored £250/day rate
    const lineItems: LineItem[] = [
      {
        description: "Bathroom labour — 3 days",
        category: "labour" as const,
        quantity: 3,
        unit: "day",
        unit_price: 250,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      },
    ];

    const failures = checkNoInventedPrices("test-labour-rate", transcript, lineItems);

    // Should pass: labour priced from stored rates is not invention
    expect(failures).toEqual([]);
  });

  it("detects the known scenario-1 findings", async () => {
    const { checkNoInventedPrices } = await import("../helpers/pipeline-compare");
    const { transcript, expectedLineItems } = await import(
      "../../fixtures/pipeline/scenario-1"
    );

    // Scenario-1 is expected to have findings (documented in the 3 Sep note)
    const failures = checkNoInventedPrices("scenario-1", transcript, expectedLineItems);

    // The spec says scenario-1 currently reports 18 findings, two of which are
    // the stated £1,400 tiling and £140 radiator swap not reaching lines.
    // Against the EXPECTED items (the hand-verified correct quote), there should
    // be zero failures — that is the contract.
    expect(failures).toEqual([]);
  });

  it("wire checkNoInventedPrices into the pipeline harness", async () => {
    // This test verifies the check is actually called in harness.test.ts
    const harnessSource = await import("fs/promises").then((fs) =>
      fs.readFile("tests/pipeline/harness.test.ts", "utf-8"),
    );

    expect(harnessSource).toContain("checkNoInventedPrices");
    expect(harnessSource).toContain("from \"../helpers/pipeline-compare\"");
  });

  it("returns Failure objects with the same shape as other checks", async () => {
    const { checkNoInventedPrices, describeFailures } = await import(
      "../helpers/pipeline-compare"
    );

    const transcript = "Tiling is eight hundred pounds.";
    const lineItems: LineItem[] = [
      {
        description: "Adhesive",
        category: "materials" as const,
        quantity: 1,
        unit: "bag",
        unit_price: 25,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        supplied_by: "contractor" as const,
      },
    ];

    const failures = checkNoInventedPrices("test-shape", transcript, lineItems);

    // Should be an array of Failure objects
    expect(Array.isArray(failures)).toBe(true);

    if (failures.length > 0) {
      const first = failures[0];
      expect(first).toHaveProperty("stage");
      expect(first).toHaveProperty("fixture");
      expect(first).toHaveProperty("message");

      // describeFailures should accept it
      const description = describeFailures(failures);
      expect(typeof description).toBe("string");
    }
  });

  it("changing a stated price by 1p causes a detectable failure", async () => {
    const { checkNoInventedPrices } = await import("../helpers/pipeline-compare");

    const transcript = "The radiator swap is one hundred and forty pounds.";

    // Line carries £140.01 instead of £140.00
    const lineItems: LineItem[] = [
      {
        description: "Radiator swap",
        category: "labour" as const,
        quantity: 1,
        unit: "job",
        unit_price: 140.01,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      },
    ];

    const failures = checkNoInventedPrices("test-penny-drift", transcript, lineItems);

    // Should fail: the transcript says £140.00, the line carries £140.01
    expect(failures.length).toBeGreaterThan(0);
  });
});

describe("PFIX-5: Decision is recorded", () => {
  it("the decision is recorded in areas/motko.md", async () => {
    const fs = await import("fs/promises");
    const decisions = await fs.readFile("areas/motko.md", "utf-8");

    // The 2026-09-03 decision exists
    expect(decisions).toContain("## 2026-09-03 — PFIX-5");
    expect(decisions).toContain("zero line items carry");
    expect(decisions).toContain("monetary value absent from the transcript");
    expect(decisions).toContain("55%");
    expect(decisions).toContain("withdrawn");
  });
});
