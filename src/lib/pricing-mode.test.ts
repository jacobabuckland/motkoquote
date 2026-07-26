import { describe, expect, it } from "vitest";
import {
  applyPricingMode,
  buildFixedModeLineItems,
  deriveWorksDescription,
} from "@/lib/pricing-mode";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";
import { EMPTY_SOW_STATE } from "@/lib/schemas/sow";
import type { LineItem } from "@/lib/schemas/job";

// A two-person labour crew — owner £340 + labourer £120 — over four days,
// the "four days, me and Liam" fixture. lineItemTotal = (340 + 120) × 4.
const crewLine: LineItem = {
  description: "Labour",
  category: "labour",
  quantity: 4,
  unit: "day",
  unit_price: 0,
  multiplier: 1,
  people_count: 2,
  overtime: false,
  assumed: false,
  people: [
    { label: "Owner", days: 4, day_rate: 340 },
    { label: "Liam", days: 4, day_rate: 120 },
  ],
};

describe("deriveWorksDescription", () => {
  it("sentence-cases the trade and appends a works phrase", () => {
    expect(deriveWorksDescription("plastering")).toBe("Plastering works as described");
  });

  it("falls back to a neutral phrase when the job type is empty", () => {
    expect(deriveWorksDescription("")).toBe("Works as described");
    expect(deriveWorksDescription("   ")).toBe("Works as described");
  });
});

describe("buildFixedModeLineItems", () => {
  it("renders a single works line at the stated net amount", () => {
    const lines = buildFixedModeLineItems("Plastering works as described", 2000, []);
    expect(lines).toHaveLength(1);
    const [works] = lines;
    expect(works).toMatchObject({
      description: "Plastering works as described",
      category: "other",
      quantity: 1,
      unit: "job",
      unit_price: 2000,
      multiplier: 1,
      people_count: 1,
    });
  });

  it("treats the stated figure as net — VAT applies on top when registered", () => {
    const lines = buildFixedModeLineItems("Works as described", 2000, []);
    expect(computeQuoteTotals(lines, true)).toEqual({ subtotal: 2000, vat: 400, total: 2400 });
    expect(computeQuoteTotals(lines, false)).toEqual({ subtotal: 2000, vat: 0, total: 2000 });
  });

  it("carries provisional sums through after the works line", () => {
    const provisional: LineItem = {
      description: "Soil stack replacement (condition unknown)",
      category: "other",
      quantity: 1,
      unit: "sum",
      unit_price: 350,
      multiplier: 1,
      people_count: 1,
      overtime: false,
      assumed: true,
      provisional: true,
    };
    const lines = buildFixedModeLineItems("Works as described", 2000, [provisional]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(provisional);
    // Fixed works + provisional sum both feed the subtotal; VAT on top.
    expect(computeQuoteTotals(lines, true)).toEqual({ subtotal: 2350, vat: 470, total: 2820 });
  });
});

// Task B regression fixtures — one per mode, over the same calculated draft.
describe("applyPricingMode", () => {
  it("days: keeps the calculated breakdown — (340 + 120) × 4", () => {
    const sow = {
      ...EMPTY_SOW_STATE,
      job_type: "electrical",
      pricing: { mode: "days" as const, fixed_amount: null },
    };
    const active = applyPricingMode([crewLine], sow);
    expect(active).toEqual([crewLine]);
    expect(lineItemTotal(crewLine)).toBe((340 + 120) * 4);
    expect(computeQuoteTotals(active, false).subtotal).toBe(1840);
  });

  it("fixed: collapses to a single works line at the stated amount, VAT on top", () => {
    const sow = {
      ...EMPTY_SOW_STATE,
      job_type: "plastering",
      pricing: { mode: "fixed" as const, fixed_amount: 2000 },
    };
    const active = applyPricingMode([crewLine], sow);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      description: "Plastering works as described",
      unit_price: 2000,
      category: "other",
    });
    expect(computeQuoteTotals(active, true)).toEqual({ subtotal: 2000, vat: 400, total: 2400 });
  });

  it("fixed: keeps provisional sums alongside the works line", () => {
    const provisional: LineItem = {
      description: "Consumer unit upgrade (condition unknown)",
      category: "other",
      quantity: 1,
      unit: "sum",
      unit_price: 450,
      multiplier: 1,
      people_count: 1,
      overtime: false,
      assumed: true,
      provisional: true,
    };
    const sow = {
      ...EMPTY_SOW_STATE,
      job_type: "electrical",
      pricing: { mode: "fixed" as const, fixed_amount: 2000 },
    };
    const active = applyPricingMode([crewLine, provisional], sow);
    expect(active).toHaveLength(2);
    expect(active[0]?.unit_price).toBe(2000);
    expect(active[1]).toBe(provisional);
  });

  it("calculated: produces the current calculated draft unchanged", () => {
    const sow = {
      ...EMPTY_SOW_STATE,
      job_type: "electrical",
      pricing: { mode: "calculated" as const, fixed_amount: null },
    };
    expect(applyPricingMode([crewLine], sow)).toEqual([crewLine]);
  });

  it("defaults to the calculated draft when no mode is set", () => {
    const sow = { ...EMPTY_SOW_STATE, job_type: "electrical", pricing: null };
    expect(applyPricingMode([crewLine], sow)).toEqual([crewLine]);
  });
});
