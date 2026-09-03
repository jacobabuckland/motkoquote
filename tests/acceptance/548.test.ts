import { describe, it, expect, vi } from "vitest";

// Mock the LLM calls at the top level
vi.mock("@/lib/claude", () => ({
  generateSowNarrative: vi.fn(async () => "Overview narrative"),
  draftQuoteLineItems: vi.fn(async () => ({
    line_items: [],
    contractor_flags: [],
  })),
}));

describe("PFIX-4: First-run invention guard", () => {
  it("hasPricingHistory returns false for business-setup chunks only", async () => {
    const { hasPricingHistory } = await import("@/lib/pricing-history");

    // Business-setup content has no pricing data, just rates and profile
    const result = hasPricingHistory({
      knownMaterialPrices: [],
      rateCards: [],
      // This is what retrieval returns: a business-setup chunk with no line items
      similarPastJobs: [
        "Business setup for Test Contractor (Electrician). VAT registered. Rates: Day rate: £300, Overtime rate: £450. Business profile: company_size: 1-5, years_trading: 5-10.",
      ],
    });

    expect(result).toBe(false);
  });

  it("hasPricingHistory returns true when similarPastJobs contains actual pricing", async () => {
    const { hasPricingHistory } = await import("@/lib/pricing-history");

    // A quote chunk contains job type, scope, and line items with prices
    const result = hasPricingHistory({
      knownMaterialPrices: [],
      rateCards: [],
      similarPastJobs: [
        "Job type: Electrical work\nScope: Install consumer unit, Install sockets\nLine items:\nConsumer unit installation: 1 item @ £450 (other)\nLabour: 2 day @ £300 (labour)",
      ],
    });

    expect(result).toBe(true);
  });

  it("hasPricingHistory returns false for empty similarPastJobs", async () => {
    const { hasPricingHistory } = await import("@/lib/pricing-history");

    const result = hasPricingHistory({
      knownMaterialPrices: [],
      rateCards: [],
      similarPastJobs: [],
    });

    expect(result).toBe(false);
  });

  it("hasPricingHistory returns true when knownMaterialPrices is non-empty", async () => {
    const { hasPricingHistory } = await import("@/lib/pricing-history");

    const result = hasPricingHistory({
      knownMaterialPrices: [{ description: "Twin and earth cable", unit: "m", unit_price: 2.5 }],
      rateCards: [],
      similarPastJobs: [],
    });

    expect(result).toBe(true);
  });

  it("hasPricingHistory returns true when rateCards is non-empty", async () => {
    const { hasPricingHistory } = await import("@/lib/pricing-history");

    const result = hasPricingHistory({
      knownMaterialPrices: [],
      rateCards: [
        { id: "rc1", work_type: "Socket installation", unit: "socket", rate_per_unit: 45 },
      ],
      similarPastJobs: [],
    });

    expect(result).toBe(true);
  });

  it("guest path explicitly sets has_pricing_history to false", async () => {
    const { draftGuestQuote } = await import("@/lib/guest/quote");
    const compileDraft = await import("@/lib/compile-draft");

    // Spy on compileDraftToLineItems to verify it receives has_pricing_history: false
    const spy = vi.spyOn(compileDraft, "compileDraftToLineItems");

    await draftGuestQuote({
      sow: {
        complete: false,
        next_question: null,
        conversation_turns: [],
        job_type: "Electrical work",
        scope_items: ["Install sockets"],
        customer_name: "Test Customer",
        customer_email: null,
        customer_phone: null,
        site_address: null,
        pricing: null,
        agreed_costs: null,
        stated_prices: null,
        checklist_answers: {},
        used_generic_fallback: false,
      },
      reference: "TESTREF1",
      createdAt: new Date().toISOString(),
    });

    // Verify compileDraftToLineItems was called with has_pricing_history: false
    expect(spy).toHaveBeenCalled();
    const callArgs = spy.mock.calls[0];
    expect(callArgs?.[1]).toBeDefined();
    expect(callArgs?.[1]).toHaveProperty("has_pricing_history", false);

    vi.restoreAllMocks();
  });

  it("first-run contractor with no pricing history gets unpriced material lines", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const result = compileDraftToLineItems(
      [
        {
          kind: "material",
          description: "Twin and earth cable",
          quantity: 50,
          unit: "m",
          supplied_by: "contractor",
          estimated_unit_cost_pence: 250,
        },
      ],
      {
        day_rate: 300,
        overtime_rate: null,
        markup_pct: 20,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Owner",
        has_pricing_history: false,
      },
      [],
      [],
    );

    expect(result.lineItems).toHaveLength(1);
    const materialLine = result.lineItems[0];
    expect(materialLine).toBeDefined();
    expect(materialLine?.category).toBe("materials");
    expect(materialLine?.unit_price).toBe(0);
    expect(materialLine?.unpriced).toBe(true);
    expect(materialLine?.assumption_note).toBe("Not priced — add what you pay for this");
  });

  it("established contractor with pricing history gets estimated material prices", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const result = compileDraftToLineItems(
      [
        {
          kind: "material",
          description: "Twin and earth cable",
          quantity: 50,
          unit: "m",
          supplied_by: "contractor",
          estimated_unit_cost_pence: 250,
        },
      ],
      {
        day_rate: 300,
        overtime_rate: null,
        markup_pct: 20,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Owner",
        has_pricing_history: true,
      },
      [],
      [],
    );

    expect(result.lineItems).toHaveLength(1);
    const materialLine = result.lineItems[0];
    expect(materialLine).toBeDefined();
    expect(materialLine?.category).toBe("materials");
    // £2.50 * 1.20 markup = £3.00
    expect(materialLine?.unit_price).toBe(3.0);
    expect(materialLine?.assumed).toBe(true);
    expect(materialLine?.unpriced).toBeUndefined();
    expect(materialLine?.assumption_note).toBe("Estimated material cost — confirm against supplier price");
  });

  it("first-run contractor gets unpriced provisional lines", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const result = compileDraftToLineItems(
      [
        {
          kind: "provisional",
          description: "Specialist subcontractor",
          suggested_amount_pence: 50000,
          reason: "Final cost depends on survey",
        },
      ],
      {
        day_rate: 300,
        overtime_rate: null,
        markup_pct: null,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Owner",
        has_pricing_history: false,
      },
      [],
      [],
    );

    expect(result.lineItems).toHaveLength(1);
    const provisionalLine = result.lineItems[0];
    expect(provisionalLine).toBeDefined();
    expect(provisionalLine?.category).toBe("other");
    expect(provisionalLine?.unit_price).toBe(0);
    expect(provisionalLine?.unpriced).toBe(true);
    expect(provisionalLine?.provisional).toBe(true);
  });

  it("established contractor gets estimated provisional lines", async () => {
    const { compileDraftToLineItems } = await import("@/lib/compile-draft");

    const result = compileDraftToLineItems(
      [
        {
          kind: "provisional",
          description: "Specialist subcontractor",
          suggested_amount_pence: 50000,
          reason: "Final cost depends on survey",
        },
      ],
      {
        day_rate: 300,
        overtime_rate: null,
        markup_pct: null,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Owner",
        has_pricing_history: true,
      },
      [],
      [],
    );

    expect(result.lineItems).toHaveLength(1);
    const provisionalLine = result.lineItems[0];
    expect(provisionalLine).toBeDefined();
    expect(provisionalLine?.category).toBe("other");
    expect(provisionalLine?.unit_price).toBe(500);
    expect(provisionalLine?.unpriced).toBeUndefined();
    expect(provisionalLine?.provisional).toBe(true);
  });

  it("syncQuoteKnowledge is called at send time with final line items", async () => {
    // This test verifies that syncQuoteKnowledge receives the line items
    // the contractor actually sent, not the drafted ones
    const knowledge = await import("@/lib/knowledge");
    const spy = vi.spyOn(knowledge, "syncQuoteKnowledge");

    // Mock the function to prevent actual database calls
    spy.mockResolvedValue(undefined);

    const { sendQuote } = await import("@/app/jobs/actions");

    // This will fail before implementation because sendQuote doesn't call
    // syncQuoteKnowledge yet. The test verifies the call happens at send time.
    try {
      await sendQuote({
        jobId: "test-job-id",
        quoteId: "test-quote-id",
        customer: {
          name: "Test Customer",
          email: "test@example.com",
          phone: null,
          address: null,
          smsOptOut: false,
        },
        confirmZeroTotal: false,
        confirmNarrativeMismatch: false,
      });
    } catch {
      // Expected to fail (job not found, etc) - we're only checking if
      // syncQuoteKnowledge would be called in the flow
    }

    // After implementation, verify syncQuoteKnowledge is called
    // (This assertion will fail before implementation)
    expect(spy).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("contractor flags are raised when materials cannot be priced on first run", async () => {
    const { compileDraftToLineItems, UNSOURCED_PRICE_FLAG } = await import("@/lib/compile-draft");

    const result = compileDraftToLineItems(
      [
        {
          kind: "material",
          description: "Twin and earth cable",
          quantity: 50,
          unit: "m",
          supplied_by: "contractor",
          estimated_unit_cost_pence: 250,
        },
        {
          kind: "material",
          description: "Consumer unit",
          quantity: 1,
          unit: "item",
          supplied_by: "contractor",
          estimated_unit_cost_pence: 45000,
        },
      ],
      {
        day_rate: 300,
        overtime_rate: null,
        markup_pct: 20,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Owner",
        has_pricing_history: false,
      },
      [],
      [],
    );

    // Both materials should be unpriced
    expect(result.lineItems.every((item) => item.unpriced === true)).toBe(true);

    // The UNSOURCED_PRICE_FLAG should be in contractorFlags
    expect(result.contractorFlags).toContain(UNSOURCED_PRICE_FLAG);
  });

  it("hasPricingHistory distinguishes setup notes from quote chunks", async () => {
    const { hasPricingHistory } = await import("@/lib/pricing-history");

    // A setup note chunk
    const setupNoteResult = hasPricingHistory({
      knownMaterialPrices: [],
      rateCards: [],
      similarPastJobs: [
        "Notes from talking to Test Contractor: Prefers to work alone | Usually works in new builds",
      ],
    });

    expect(setupNoteResult).toBe(false);

    // Mixed chunks: one setup, one quote
    const mixedResult = hasPricingHistory({
      knownMaterialPrices: [],
      rateCards: [],
      similarPastJobs: [
        "Notes from talking to Test Contractor: Prefers to work alone",
        "Job type: Electrical work\nScope: Install sockets\nLine items:\nSockets: 5 item @ £45 (other)",
      ],
    });

    // Should return true because at least one chunk has pricing
    expect(mixedResult).toBe(true);
  });
});
