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
  // "works as described" used to be appended unconditionally, and pointed at a
  // statement of work the customer had never received. The phrase now appears
  // only when the document actually carries a scope section.
  it("points at the scope section when the document has one", () => {
    expect(deriveWorksDescription("plastering", true)).toBe(
      "Plastering works — see Scope of work",
    );
  });

  it("promises nothing when the document has no scope section", () => {
    expect(deriveWorksDescription("plastering", false)).toBe("Plastering works");
  });

  it("falls back to a neutral phrase when the job type is empty", () => {
    expect(deriveWorksDescription("", true)).toBe("Works — see Scope of work");
    expect(deriveWorksDescription("", false)).toBe("Works");
    expect(deriveWorksDescription("   ", false)).toBe("Works");
  });
});

describe("buildFixedModeLineItems", () => {
  it("renders a single works line at the stated net amount", () => {
    const lines = buildFixedModeLineItems("Plastering works — see Scope of work", 2000, []);
    expect(lines).toHaveLength(1);
    const [works] = lines;
    expect(works).toMatchObject({
      description: "Plastering works — see Scope of work",
      category: "other",
      quantity: 1,
      unit: "job",
      unit_price: 2000,
      multiplier: 1,
      people_count: 1,
    });
  });

  it("treats the stated figure as net — VAT applies on top when registered", () => {
    const lines = buildFixedModeLineItems("Works", 2000, []);
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
    const lines = buildFixedModeLineItems("Works", 2000, [provisional]);
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
    // No third argument, so hasScopeSection defaults false — the safe default
    // for a caller that cannot know what the document will carry.
    const active = applyPricingMode([crewLine], sow);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      description: "Plastering works",
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
