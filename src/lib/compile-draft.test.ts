import { describe, expect, it } from "vitest";
import { compileDraftToLineItems } from "@/lib/compile-draft";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";
import {
  fenlandContext,
  fenlandDraft,
  fenlandExpected,
} from "@/lib/fixtures/fenland-bathroom";

describe("compileDraftToLineItems — Fenland bathroom fixture", () => {
  const { lineItems, mismatches } = compileDraftToLineItems(fenlandDraft, fenlandContext);

  const labour = lineItems.filter((i) => i.category === "labour");
  const materials = lineItems.filter((i) => i.category === "materials");
  const other = lineItems.filter((i) => i.category === "other");

  it("merges the crew and the task-split line into ONE labour line", () => {
    expect(labour).toHaveLength(1);
  });

  it("prices the mixed-rate crew from confirmed day rates on one line", () => {
    expect(lineItemTotal(labour[0]!)).toBe(fenlandExpected.labourLineTotal);
  });

  it("labels the apprentice from team_members, never LLM prose", () => {
    const labels = labour[0]!.people?.map((p) => p.label) ?? [];
    expect(labels).toContain("Liam (Apprentice)");
    expect(labels).toContain("Owner");
  });

  it("does not let the task-split line add days — owner stays at 5", () => {
    const owner = labour[0]!.people?.find((p) => p.label === "Owner");
    expect(owner?.days).toBe(5);
  });

  it("folds the task-split description into includes_tasks", () => {
    expect(labour[0]!.includes_tasks).toContain("Tiling — 14m²");
    expect(labour[0]!.includes_tasks).toContain("Full strip-out");
  });

  it("prices customer-supplied materials at £0 with a supplied-by note", () => {
    const customer = materials.filter((i) => i.supplied_by === "customer");
    expect(customer).toHaveLength(2);
    for (const item of customer) {
      expect(item.unit_price).toBe(0);
      expect(item.assumption_note).toBe("Supplied by the customer");
    }
  });

  it("applies the 25% markup to contractor-supplied materials", () => {
    const contractor = materials.find((i) => i.supplied_by === "contractor");
    expect(contractor?.unit_price).toBe(fenlandExpected.contractorMaterialUnitPrice);
    expect(contractor?.assumed).toBe(true);
  });

  it("prices the radiator swap from the rate card", () => {
    const radiator = other.find((i) => i.rate_card_id === "rc-radiator");
    expect(radiator?.unit_price).toBe(fenlandExpected.radiatorUnitPrice);
    expect(radiator?.assumed).toBe(false);
  });

  it("carries the soil-stack provisional sum as an editable suggestion", () => {
    const provisional = other.find((i) => i.provisional);
    expect(provisional?.unit_price).toBe(fenlandExpected.provisionalUnitPrice);
    expect(provisional?.assumed).toBe(true);
  });

  it("computes VAT on the subtotal and the gross total", () => {
    const totals = computeQuoteTotals(lineItems, true);
    expect(totals.subtotal).toBe(fenlandExpected.subtotal);
    expect(totals.vat).toBe(fenlandExpected.vat);
    expect(totals.total).toBe(fenlandExpected.total);
  });

  it("records no mismatches for a fully-resolved draft", () => {
    expect(mismatches).toHaveLength(0);
  });
});
