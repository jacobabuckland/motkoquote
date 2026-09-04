import { describe, it, expect } from "vitest";
import type { LineItem, LineItemProvenance } from "@/lib/schemas/job";
import type { SowState } from "@/lib/schemas/sow";
import type { StatedPrice } from "@/lib/schemas/stated-price";

describe("PFIX-7: Fixed-price dead end", () => {

  it("extends provenance schema to include system-generated source", async () => {
    const { lineItemProvenanceSchema } = await import("@/lib/schemas/job");

    // Should accept the new system-generated source
    const systemProvenance: LineItemProvenance = {
      source: "system-generated",
    };

    expect(() => lineItemProvenanceSchema.parse(systemProvenance)).not.toThrow();

    // Should still accept the existing sources
    const transcriptProvenance: LineItemProvenance = {
      source: "transcript",
      transcript_span: "Labour will be five hundred pounds",
    };
    expect(() => lineItemProvenanceSchema.parse(transcriptProvenance)).not.toThrow();

    const contractorProvenance: LineItemProvenance = {
      source: "contractor",
    };
    expect(() => lineItemProvenanceSchema.parse(contractorProvenance)).not.toThrow();
  });

  it("buildFixedModeLineItems attaches system-generated provenance to the works line", async () => {
    const { buildFixedModeLineItems } = await import("@/lib/pricing-mode");

    const worksDescription = "Electrical rewire works — see Scope of work";
    const fixedAmount = 2500.0;
    const provisionalItems: LineItem[] = [
      {
        description: "Provisional sum for unforeseen structural work",
        category: "other",
        quantity: 1,
        unit: "sum",
        unit_price: 500.0,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        assumption_note: undefined,
        customer_note: undefined,
        provisional: true,
      },
    ];

    const result = buildFixedModeLineItems(worksDescription, fixedAmount, provisionalItems);

    expect(result).toHaveLength(2);
    const worksLine = result[0];

    // The works line must have system-generated provenance
    expect(worksLine.provenance).toBeDefined();
    expect(worksLine.provenance?.source).toBe("system-generated");
    expect(worksLine.description).toBe(worksDescription);
    expect(worksLine.unit_price).toBe(fixedAmount);

    // The provisional item should be unchanged
    expect(result[1]).toEqual(provisionalItems[0]);
  });

  it("reconcileStatedPrice accepts system-generated provenance and does not fail", async () => {
    const { reconcileStatedPrice } = await import("@/lib/stated-price-guard");

    const statedPrices: StatedPrice[] = [
      {
        amount: 50000, // £500 in pence
        item: "consumer unit replacement",
        transcript_span: "The consumer unit will be five hundred pounds",
        qualifiers: {
          each: false,
          fitted: false,
          already_paid: false,
          excluded: false,
        },
        superseded_by: null,
      },
    ];

    const sow: Partial<Pick<SowState, "pricing" | "stated_prices">> = {
      pricing: {
        mode: "fixed",
        fixed_amount: 2500.0,
      },
      stated_prices: statedPrices,
    };

    const lineItems: LineItem[] = [
      {
        description: "Electrical rewire works — see Scope of work",
        category: "other",
        quantity: 1,
        unit: "job",
        unit_price: 2500.0,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        assumption_note: undefined,
        customer_note: undefined,
        provenance: {
          source: "system-generated",
        },
      },
      {
        description: "Consumer unit replacement",
        category: "materials",
        quantity: 1,
        unit: "unit",
        unit_price: 500.0,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        assumption_note: undefined,
        customer_note: undefined,
        provisional: true,
        provenance: {
          source: "transcript",
          transcript_span: "The consumer unit will be five hundred pounds",
        },
      },
    ];

    const flag = reconcileStatedPrice(sow, lineItems);

    // Should NOT report "Unsourced line" for the system-generated works line
    expect(flag ?? "").not.toContain("Unsourced line");
    expect(flag ?? "").not.toContain("has no provenance");
  });

  it("reproduction: fixed mode + stated price + collapsed works line can be sent", async () => {
    const { reconcileStatedPrice } = await import("@/lib/stated-price-guard");
    const { buildFixedModeLineItems } = await import("@/lib/pricing-mode");

    // Step 1: A contractor runs a voice call that extracts one stated price
    const statedPrices: StatedPrice[] = [
      {
        amount: 52000, // £520 in pence
        item: "labour",
        transcript_span: "Labour will be five hundred and twenty pounds",
        qualifiers: {
          each: false,
          fitted: false,
          already_paid: false,
          excluded: false,
        },
        superseded_by: null,
      },
    ];

    // Step 2: The contractor switches to fixed pricing mode with a total of £2,500
    const fixedAmount = 2500.0;
    const worksDescription = "Rewire works — see Scope of work";

    // The pricing mode collapses the calculated breakdown into one works line
    const collapsedLines = buildFixedModeLineItems(worksDescription, fixedAmount, []);

    expect(collapsedLines).toHaveLength(1);
    const worksLine = collapsedLines[0];

    // Step 3: The works line has system-generated provenance
    expect(worksLine.provenance?.source).toBe("system-generated");

    // Step 4: Reconciliation does not fail on the system-generated line
    const sow: Partial<Pick<SowState, "pricing" | "stated_prices">> = {
      pricing: {
        mode: "fixed",
        fixed_amount: fixedAmount,
      },
      stated_prices: statedPrices,
    };

    const flag = reconcileStatedPrice(sow, collapsedLines);

    // No "Unsourced line" flag should be raised
    expect(flag).toBeNull();
  });

  it("switching into fixed mode from calculated mode keeps provenance on provisional items", async () => {
    const { buildFixedModeLineItems } = await import("@/lib/pricing-mode");

    const provisionalWithProvenance: LineItem[] = [
      {
        description: "Provisional sum for concealed wiring",
        category: "other",
        quantity: 1,
        unit: "sum",
        unit_price: 300.0,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        assumption_note: undefined,
        customer_note: undefined,
        provisional: true,
        provenance: {
          source: "transcript",
          transcript_span: "We might need three hundred for hidden runs",
        },
      },
    ];

    const result = buildFixedModeLineItems(
      "Electrical works",
      1500.0,
      provisionalWithProvenance,
    );

    expect(result).toHaveLength(2);

    // The works line gets system-generated
    expect(result[0].provenance?.source).toBe("system-generated");

    // The provisional item keeps its transcript provenance
    expect(result[1].provenance?.source).toBe("transcript");
    expect(result[1].provenance?.transcript_span).toBe(
      "We might need three hundred for hidden runs",
    );
  });

  it("manual fixed-price job with no stated prices does not break", async () => {
    const { reconcileStatedPrice } = await import("@/lib/stated-price-guard");
    const { buildFixedModeLineItems } = await import("@/lib/pricing-mode");

    // A contractor creates a manual job and sets it to fixed pricing
    // No transcript, no extraction, so stated_prices is empty
    const collapsedLines = buildFixedModeLineItems("Kitchen rewire works", 3000.0, []);

    const sow: Partial<Pick<SowState, "pricing" | "stated_prices">> = {
      pricing: {
        mode: "fixed",
        fixed_amount: 3000.0,
      },
      stated_prices: [], // Empty: no transcript extraction
    };

    // Provenance checks should not run when stated_prices is empty
    const flag = reconcileStatedPrice(sow, collapsedLines);

    // Should not fail
    expect(flag).toBeNull();
  });

  it("system-generated provenance survives a switch out and back into fixed mode", async () => {
    const { buildFixedModeLineItems } = await import("@/lib/pricing-mode");

    // First collapse into fixed mode
    const firstCollapse = buildFixedModeLineItems("Rewire works", 2000.0, []);
    expect(firstCollapse[0].provenance?.source).toBe("system-generated");

    // (In real flow, the calculated breakdown would be restored from drafted_line_items_json
    // when switching out of fixed mode. Here we're just verifying the next collapse.)

    // Switch back into fixed mode with a different amount
    const secondCollapse = buildFixedModeLineItems("Rewire works — see Scope of work", 2200.0, []);
    expect(secondCollapse[0].provenance?.source).toBe("system-generated");

    // Each collapse creates a fresh works line with system-generated provenance
    expect(secondCollapse).toHaveLength(1);
  });

  it("a fixed-price quote with multiple stated prices and one works line still sends", async () => {
    const { reconcileStatedPrice } = await import("@/lib/stated-price-guard");

    // Multiple component prices stated during the call
    const statedPrices: StatedPrice[] = [
      {
        amount: 50000, // £500
        item: "consumer unit",
        transcript_span: "The consumer unit is five hundred pounds",
        qualifiers: { each: false, fitted: false, already_paid: false, excluded: false },
        superseded_by: null,
      },
      {
        amount: 120000, // £1,200
        item: "labour",
        transcript_span: "Labour will be twelve hundred",
        qualifiers: { each: false, fitted: false, already_paid: false, excluded: false },
        superseded_by: null,
      },
    ];

    // Contractor then states a fixed total
    const sow: Partial<Pick<SowState, "pricing" | "stated_prices">> = {
      pricing: {
        mode: "fixed",
        fixed_amount: 2500.0, // Does not match any individual stated price
      },
      stated_prices: statedPrices,
    };

    // The works line at the fixed amount
    const lineItems: LineItem[] = [
      {
        description: "Electrical installation works",
        category: "other",
        quantity: 1,
        unit: "job",
        unit_price: 2500.0,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        assumption_note: undefined,
        customer_note: undefined,
        provenance: {
          source: "system-generated",
        },
      },
    ];

    const flag = reconcileStatedPrice(sow, lineItems);

    // Should not fail with "Amount mismatch" or "Unsourced line"
    // The £2,500 works line does not match £500 or £1,200 individually, but that's legitimate
    expect(flag ?? "").not.toContain("Unsourced line");
    // (The fixed-amount check may still report a mismatch between £2,500 and the breakdown,
    // but that's a separate concern and the system-generated provenance should not block it)
  });
});
