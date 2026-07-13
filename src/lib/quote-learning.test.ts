import { describe, expect, it } from "vitest";
import type { LineItem } from "@/lib/schemas/job";
import { diffLineItems, summarizeTendencies } from "@/lib/quote-learning";

const item = (overrides: Partial<LineItem> = {}): LineItem => ({
  description: "Plastering – skim coat",
  category: "labour",
  quantity: 2,
  unit: "day",
  unit_price: 150,
  multiplier: 1,
  assumed: false,
  ...overrides,
});

describe("diffLineItems", () => {
  it("emits nothing when the final quote matches the draft", () => {
    expect(diffLineItems([item()], [item()])).toEqual([]);
  });

  it("is case- and punctuation-insensitive when matching descriptions", () => {
    const drafted = [item({ description: "Plastering – skim coat" })];
    const final = [item({ description: "plastering skim coat", unit_price: 150 })];
    expect(diffLineItems(drafted, final)).toEqual([]);
  });

  it("emits a modified edit when unit_price changes", () => {
    const drafted = [item({ unit_price: 150 })];
    const final = [item({ unit_price: 180 })];
    expect(diffLineItems(drafted, final)).toEqual([
      {
        description: "Plastering – skim coat",
        normalized_description: "plastering skim coat",
        category: "labour",
        edit_type: "modified",
        drafted_quantity: 2,
        drafted_unit_price: 150,
        drafted_multiplier: 1,
        final_quantity: 2,
        final_unit_price: 180,
        final_multiplier: 1,
      },
    ]);
  });

  it("emits a modified edit when quantity or multiplier changes", () => {
    const drafted = [item()];
    const final = [item({ quantity: 3, multiplier: 1.5 })];
    const [edit] = diffLineItems(drafted, final);
    expect(edit?.edit_type).toBe("modified");
    expect(edit?.final_quantity).toBe(3);
    expect(edit?.final_multiplier).toBe(1.5);
  });

  it("emits an added edit for a line item the contractor introduced", () => {
    const drafted = [item()];
    const final = [item(), item({ description: "Skip hire", category: "other", unit_price: 250 })];
    const edits = diffLineItems(drafted, final);
    expect(edits).toEqual([
      {
        description: "Skip hire",
        normalized_description: "skip hire",
        category: "other",
        edit_type: "added",
        drafted_quantity: null,
        drafted_unit_price: null,
        drafted_multiplier: null,
        final_quantity: 2,
        final_unit_price: 250,
        final_multiplier: 1,
      },
    ]);
  });

  it("emits a removed edit for a drafted line item the contractor deleted", () => {
    const drafted = [item(), item({ description: "Travel", category: "travel", unit_price: 40 })];
    const final = [item()];
    const edits = diffLineItems(drafted, final);
    expect(edits).toEqual([
      {
        description: "Travel",
        normalized_description: "travel",
        category: "travel",
        edit_type: "removed",
        drafted_quantity: 2,
        drafted_unit_price: 40,
        drafted_multiplier: 1,
        final_quantity: null,
        final_unit_price: null,
        final_multiplier: null,
      },
    ]);
  });
});

describe("summarizeTendencies", () => {
  const modifiedEdit = (category: string, draftedPrice: number, finalPrice: number) => ({
    description: `${category} work`,
    normalized_description: `${category} work`,
    category,
    edit_type: "modified" as const,
    drafted_unit_price: draftedPrice,
    final_unit_price: finalPrice,
  });

  const addedEdit = (description: string) => ({
    description,
    normalized_description: description.toLowerCase(),
    category: "other",
    edit_type: "added" as const,
    drafted_unit_price: null,
    final_unit_price: 50,
  });

  const removedEdit = (description: string) => ({
    description,
    normalized_description: description.toLowerCase(),
    category: "other",
    edit_type: "removed" as const,
    drafted_unit_price: 50,
    final_unit_price: null,
  });

  it("surfaces a systematic price correction once it recurs across enough quotes", () => {
    const edits = [
      modifiedEdit("plastering", 100, 120),
      modifiedEdit("plastering", 200, 230),
    ];
    const [tendency] = summarizeTendencies(edits);
    expect(tendency).toContain("plastering");
    expect(tendency).toContain("higher");
  });

  it("does not surface a price correction from a single sample", () => {
    const edits = [modifiedEdit("plastering", 100, 120)];
    expect(summarizeTendencies(edits)).toEqual([]);
  });

  it("does not surface a price correction below the significance threshold", () => {
    // ~1% average delta — too small to be a real pattern
    const edits = [modifiedEdit("plastering", 100, 101), modifiedEdit("plastering", 100, 101)];
    expect(summarizeTendencies(edits)).toEqual([]);
  });

  it("surfaces a recurring added line item", () => {
    const edits = [addedEdit("Skip hire"), addedEdit("Skip hire")];
    const [tendency] = summarizeTendencies(edits);
    expect(tendency).toContain("Skip hire");
    expect(tendency).toContain("2 past quotes");
  });

  it("does not surface a one-off added line item", () => {
    expect(summarizeTendencies([addedEdit("Skip hire")])).toEqual([]);
  });

  it("surfaces a recurring removed line item", () => {
    const edits = [removedEdit("Contingency"), removedEdit("Contingency")];
    const [tendency] = summarizeTendencies(edits);
    expect(tendency).toContain("Contingency");
    expect(tendency).toContain("removed");
  });

  it("caps output at 5 tendencies, ranked by sample size", () => {
    const edits = [
      ...Array(6)
        .fill(null)
        .map((_, i) => addedEdit(`Item ${i}`))
        .flatMap((e) => [e, e]), // each appears twice → qualifies
    ];
    expect(summarizeTendencies(edits).length).toBeLessThanOrEqual(5);
  });
});
