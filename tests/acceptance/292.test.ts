import { describe, expect, it } from "vitest";
import { synthesizeTimeline } from "@/lib/schemas/sow";
import type { SowState } from "@/lib/schemas/sow";
import type { QuotePdfPayload } from "@/lib/pdf/quote-payload";

describe("Issue #292: Carry scope of works onto customer-facing quote", () => {
  it("QuotePdfPayload has an optional scope field", async () => {
    const mod = await import("@/lib/pdf/quote-payload");

    // A payload with scope omitted should be valid
    const payloadWithoutScope: QuotePdfPayload = {
      reference: "TEST123",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: [],
      contractor: null,
      customer: null,
    };

    // A payload with scope should also be valid
    const payloadWithScope: QuotePdfPayload = {
      reference: "TEST456",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: [],
      contractor: null,
      customer: null,
      scope: {
        overviewNarrative: "Test overview",
        rooms: [],
        additionalItems: [],
        existingConditions: undefined,
        accessIssues: undefined,
        inclusions: [],
        exclusions: [],
        materialsMentioned: [],
        materialsSupply: null,
        assumptions: [],
        timeline: "2 days",
      },
    };

    // Should be able to build a document from either
    expect(() => mod.buildQuotePdfDocument(payloadWithoutScope)).not.toThrow();
    expect(() => mod.buildQuotePdfDocument(payloadWithScope)).not.toThrow();
  });

  it("buildQuoteScope exists and returns QuoteScope from SowState", async () => {
    const { buildQuoteScope } = await import("@/lib/pdf/quote-payload");

    const sow: SowState = {
      job_type: "rewire",
      rooms: [{ name: "Kitchen", dimensions: "4m x 3m", work_items: ["Install 6 double sockets"] }],
      materials_mentioned: ["2.5mm cable"],
      access_issues: "Occupied property",
      existing_conditions: "Old rubber cable",
      timeline: "3 days",
      labour_plan: { people_count: 2, duration_days: 3, crew_description: "Me and apprentice" },
      deadline: null,
      materials_supply: { contractor_supplied: ["cable"], customer_supplied: [] },
      agreed_costs: null,
      pricing: null,
      inclusions: ["Making good"],
      exclusions: ["Decorating"],
      additional_items: ["Haul rubbish"],
      assumptions_and_unknowns: [{ description: "Earthing OK", treatment: "assumed_ok" }],
      customer_name: "Test Customer",
      site_address: "123 Test St",
      customer_phone: undefined,
      customer_email: undefined,
      complete: true,
      next_question: undefined,
      overview_narrative: "Full rewire of kitchen",
      reclassification_count: 0,
      used_generic_fallback: false,
      wrap_incomplete: false,
      unasked_required: [],
    };

    const scope = buildQuoteScope(sow);

    expect(scope).toBeDefined();
    expect(scope).not.toBeNull();
    expect(scope?.rooms).toHaveLength(1);
    expect(scope?.rooms[0]?.name).toBe("Kitchen");
    expect(scope?.inclusions).toContain("Making good");
    expect(scope?.exclusions).toContain("Decorating");
  });

  it("buildQuoteScope returns null when scope is too thin", async () => {
    const { buildQuoteScope } = await import("@/lib/pdf/quote-payload");

    const thinSow: SowState = {
      job_type: "rewire",
      rooms: [],
      materials_mentioned: [],
      access_issues: undefined,
      existing_conditions: undefined,
      timeline: undefined,
      labour_plan: null,
      deadline: null,
      materials_supply: null,
      agreed_costs: null,
      pricing: null,
      inclusions: [],
      exclusions: [],
      additional_items: [],
      assumptions_and_unknowns: [],
      customer_name: undefined,
      site_address: undefined,
      customer_phone: undefined,
      customer_email: undefined,
      complete: false,
      next_question: undefined,
      overview_narrative: undefined,
      reclassification_count: 0,
      used_generic_fallback: false,
      wrap_incomplete: false,
      unasked_required: [],
    };

    const scope = buildQuoteScope(thinSow);
    expect(scope).toBeNull();
  });

  it("renderQuotePdf's select string contains sow_json", async () => {
    // Read the source file and verify the select includes sow_json
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const renderQuotePath = path.join(process.cwd(), "src/lib/pdf/render-quote.ts");
    const content = await fs.readFile(renderQuotePath, "utf8");

    // Find the select call within renderQuotePdf function
    const renderQuotePdfMatch = content.match(/export const renderQuotePdf[\s\S]*?\.select\s*\(\s*["'`]([\s\S]*?)["'`]\s*\)/);
    expect(renderQuotePdfMatch, "Could not find select string in renderQuotePdf").toBeTruthy();

    const selectString = renderQuotePdfMatch![1];
    expect(selectString, "select string should include sow_json").toMatch(/sow_json/);
  });

  it("a quote with populated sow_json produces PDF containing Scope of work and room details", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { buildQuotePdfDocument } = await import("@/lib/pdf/quote-payload");

    const payload: QuotePdfPayload = {
      reference: "TEST789",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: [],
      contractor: { companyName: "Test Co", vatRegistered: false },
      customer: { name: "Test Customer" },
      scope: {
        overviewNarrative: "This is a rewire job",
        rooms: [
          { name: "Kitchen", dimensions: "4m x 3m", work_items: ["Install 6 double sockets", "Install cooker circuit"] },
          { name: "Living Room", dimensions: undefined, work_items: ["Install 4 double sockets"] },
        ],
        additionalItems: ["Consumer unit upgrade"],
        existingConditions: "Old rubber cable throughout",
        accessIssues: "Occupied property, work 9am-5pm only",
        inclusions: ["Making good", "Testing and certification"],
        exclusions: ["Decorating", "Moving furniture"],
        materialsMentioned: ["2.5mm cable", "sockets"],
        materialsSupply: { contractor_supplied: ["cable"], customer_supplied: ["consumer unit"] },
        assumptions: [
          { description: "Earthing and bonding adequate", treatment: "assumed_ok" },
          { description: "Asbestos survey", treatment: "excluded" },
        ],
        timeline: "3 working days, 2-person team",
      },
    };

    const document = buildQuotePdfDocument(payload);
    const buffer = await renderToBuffer(document as never);
    const pdfText = buffer.toString("latin1");

    expect(pdfText).toMatch(/Scope of work/i);
    expect(pdfText).toMatch(/Kitchen/);
    expect(pdfText).toMatch(/Living Room/);
    expect(pdfText).toMatch(/Install 6 double sockets/);
    expect(pdfText).toMatch(/Install cooker circuit/);
    expect(pdfText).toMatch(/Install 4 double sockets/);
  });

  it("PDF contains timeline exactly equal to synthesizeTimeline(sow, crewSize)", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { buildQuotePdfDocument, buildQuoteScope } = await import("@/lib/pdf/quote-payload");

    const sow: SowState = {
      job_type: "rewire",
      rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Install sockets"] }],
      materials_mentioned: [],
      access_issues: undefined,
      existing_conditions: undefined,
      timeline: undefined,
      labour_plan: { people_count: 2, duration_days: 4, crew_description: "Me and apprentice" },
      deadline: { quote_by: undefined, job_by: "End of month" },
      materials_supply: null,
      agreed_costs: null,
      pricing: null,
      inclusions: [],
      exclusions: [],
      additional_items: [],
      assumptions_and_unknowns: [],
      customer_name: undefined,
      site_address: undefined,
      customer_phone: undefined,
      customer_email: undefined,
      complete: true,
      next_question: undefined,
      overview_narrative: undefined,
      reclassification_count: 0,
      used_generic_fallback: false,
      wrap_incomplete: false,
      unasked_required: [],
    };

    const crewSize = 2;
    const expectedTimeline = synthesizeTimeline(sow, crewSize);

    const scope = buildQuoteScope(sow, crewSize);
    expect(scope?.timeline).toBe(expectedTimeline);

    const payload: QuotePdfPayload = {
      reference: "TEST",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: [],
      contractor: null,
      customer: null,
      scope,
    };

    const document = buildQuotePdfDocument(payload);
    const buffer = await renderToBuffer(document as never);
    const pdfText = buffer.toString("latin1");

    expect(pdfText).toContain(expectedTimeline);
  });

  it("PDF contains inclusions, exclusions, additional_items, and assumptions", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { buildQuotePdfDocument } = await import("@/lib/pdf/quote-payload");

    const payload: QuotePdfPayload = {
      reference: "TEST",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: [],
      contractor: null,
      customer: null,
      scope: {
        overviewNarrative: undefined,
        rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Test work"] }],
        additionalItems: ["Haul away debris", "Install smoke alarms"],
        existingConditions: undefined,
        accessIssues: undefined,
        inclusions: ["Making good", "Testing and certification", "Clean up"],
        exclusions: ["Decorating", "Moving furniture", "Scaffolding"],
        materialsMentioned: [],
        materialsSupply: null,
        assumptions: [
          { description: "Earthing adequate, may need upgrade", treatment: "provisional_sum" },
          { description: "Asbestos present", treatment: "excluded" },
          { description: "Board condition OK", treatment: "assumed_ok" },
        ],
        timeline: "TBC",
      },
    };

    const document = buildQuotePdfDocument(payload);
    const buffer = await renderToBuffer(document as never);
    const pdfText = buffer.toString("latin1");

    // Inclusions
    expect(pdfText).toMatch(/Making good/);
    expect(pdfText).toMatch(/Testing and certification/);
    expect(pdfText).toMatch(/Clean up/);

    // Exclusions
    expect(pdfText).toMatch(/Decorating/);
    expect(pdfText).toMatch(/Moving furniture/);
    expect(pdfText).toMatch(/Scaffolding/);

    // Additional items
    expect(pdfText).toMatch(/Haul away debris/);
    expect(pdfText).toMatch(/Install smoke alarms/);

    // Assumptions
    expect(pdfText).toMatch(/Earthing adequate/);
    expect(pdfText).toMatch(/Asbestos present/);
    expect(pdfText).toMatch(/Board condition OK/);
  });

  it("PDF contains overview_narrative when non-empty", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { buildQuotePdfDocument } = await import("@/lib/pdf/quote-payload");

    const narrative = "Complete rewire of a three-bedroom semi-detached property. Work includes new consumer unit, full first and second fix, testing and certification.";

    const payload: QuotePdfPayload = {
      reference: "TEST",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: [],
      contractor: null,
      customer: null,
      scope: {
        overviewNarrative: narrative,
        rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Install sockets"] }],
        additionalItems: [],
        existingConditions: undefined,
        accessIssues: undefined,
        inclusions: [],
        exclusions: [],
        materialsMentioned: [],
        materialsSupply: null,
        assumptions: [],
        timeline: "TBC",
      },
    };

    const document = buildQuotePdfDocument(payload);
    const buffer = await renderToBuffer(document as never);
    const pdfText = buffer.toString("latin1");

    expect(pdfText).toContain(narrative);
  });

  it('deriveWorksDescription("rewire", true) === "Rewire works — see Scope of work"', async () => {
    const { deriveWorksDescription } = await import("@/lib/pricing-mode");

    const result = deriveWorksDescription("rewire", true);
    expect(result).toBe("Rewire works — see Scope of work");
  });

  it('deriveWorksDescription("rewire", false) === "Rewire works"', async () => {
    const { deriveWorksDescription } = await import("@/lib/pricing-mode");

    const result = deriveWorksDescription("rewire", false);
    expect(result).toBe("Rewire works");
  });

  it('deriveWorksDescription("", false) === "Works" and deriveWorksDescription("", true) === "Works — see Scope of work"', async () => {
    const { deriveWorksDescription } = await import("@/lib/pricing-mode");

    expect(deriveWorksDescription("", false)).toBe("Works");
    expect(deriveWorksDescription("", true)).toBe("Works — see Scope of work");
  });

  it("no rendered quote PDF contains the substring 'as described'", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { buildQuotePdfDocument } = await import("@/lib/pdf/quote-payload");
    const { applyPricingMode } = await import("@/lib/pricing-mode");

    // Test with scope present
    const payloadWithScope: QuotePdfPayload = {
      reference: "TEST1",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: applyPricingMode([], {
        job_type: "rewire",
        pricing: { mode: "fixed", fixed_amount: 2000 },
        rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Install sockets"] }],
      } as never),
      contractor: null,
      customer: null,
      scope: {
        overviewNarrative: undefined,
        rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Install sockets"] }],
        additionalItems: [],
        existingConditions: undefined,
        accessIssues: undefined,
        inclusions: [],
        exclusions: [],
        materialsMentioned: [],
        materialsSupply: null,
        assumptions: [],
        timeline: "TBC",
      },
    };

    const doc1 = buildQuotePdfDocument(payloadWithScope);
    const buf1 = await renderToBuffer(doc1 as never);
    expect(buf1.toString("latin1")).not.toMatch(/as described/i);

    // Test without scope
    const payloadWithoutScope: QuotePdfPayload = {
      reference: "TEST2",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: applyPricingMode([], {
        job_type: "rewire",
        pricing: { mode: "fixed", fixed_amount: 2000 },
        rooms: [],
      } as never),
      contractor: null,
      customer: null,
    };

    const doc2 = buildQuotePdfDocument(payloadWithoutScope);
    const buf2 = await renderToBuffer(doc2 as never);
    expect(buf2.toString("latin1")).not.toMatch(/as described/i);
  });

  it("a fixed-price quote with populated SoW renders both works line and scope section", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { buildQuotePdfDocument } = await import("@/lib/pdf/quote-payload");
    const { buildFixedModeLineItems } = await import("@/lib/pricing-mode");

    const payload: QuotePdfPayload = {
      reference: "TEST",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: buildFixedModeLineItems("Rewire works — see Scope of work", 2500, []),
      contractor: null,
      customer: null,
      scope: {
        overviewNarrative: "Full rewire",
        rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["New sockets"] }],
        additionalItems: [],
        existingConditions: undefined,
        accessIssues: undefined,
        inclusions: [],
        exclusions: [],
        materialsMentioned: [],
        materialsSupply: null,
        assumptions: [],
        timeline: "3 days",
      },
    };

    const document = buildQuotePdfDocument(payload);
    const buffer = await renderToBuffer(document as never);
    const pdfText = buffer.toString("latin1");

    // Should have the works line
    expect(pdfText).toMatch(/Rewire works/);
    expect(pdfText).toMatch(/see Scope of work/);

    // Should have the scope section
    expect(pdfText).toMatch(/Scope of work/i);
    expect(pdfText).toMatch(/Kitchen/);
    expect(pdfText).toMatch(/New sockets/);
  });

  it("an itemised quote renders scope section and full line-item breakdown", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { buildQuotePdfDocument } = await import("@/lib/pdf/quote-payload");

    const payload: QuotePdfPayload = {
      reference: "TEST",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: [
        {
          description: "Rewire labour",
          category: "labour",
          quantity: 5,
          unit: "day",
          unit_price: 340,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
          includes_tasks: ["First fix", "Second fix"],
        },
        {
          description: "Cable 2.5mm",
          category: "materials",
          quantity: 100,
          unit: "m",
          unit_price: 1.85,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
        },
      ],
      contractor: null,
      customer: null,
      scope: {
        overviewNarrative: undefined,
        rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["New wiring"] }],
        additionalItems: [],
        existingConditions: undefined,
        accessIssues: undefined,
        inclusions: [],
        exclusions: [],
        materialsMentioned: [],
        materialsSupply: null,
        assumptions: [],
        timeline: "5 days",
      },
    };

    const document = buildQuotePdfDocument(payload);
    const buffer = await renderToBuffer(document as never);
    const pdfText = buffer.toString("latin1");

    // Should have scope section
    expect(pdfText).toMatch(/Scope of work/i);
    expect(pdfText).toMatch(/Kitchen/);

    // Should have full line items
    expect(pdfText).toMatch(/Rewire labour/);
    expect(pdfText).toMatch(/Cable 2\.5mm/);
    expect(pdfText).toMatch(/First fix/);
    expect(pdfText).toMatch(/Second fix/);
  });

  it("a quote with sow_json = null renders with no scope section", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { buildQuotePdfDocument } = await import("@/lib/pdf/quote-payload");

    const payload: QuotePdfPayload = {
      reference: "TEST",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: [],
      contractor: null,
      customer: null,
      // scope field omitted
    };

    const document = buildQuotePdfDocument(payload);
    const buffer = await renderToBuffer(document as never);
    const pdfText = buffer.toString("latin1");

    expect(pdfText).not.toMatch(/Scope of work/i);
  });

  it("no customer-facing quote PDF contains contractor-only content", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { buildQuotePdfDocument } = await import("@/lib/pdf/quote-payload");

    const payload: QuotePdfPayload = {
      reference: "TEST",
      createdAt: "2026-08-19T10:00:00Z",
      lineItems: [
        {
          description: "Test line",
          category: "other",
          quantity: 1,
          unit: "job",
          unit_price: 100,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: true,
          provisional: true,
          assumption_note: "CONTRACTOR ONLY: check supplier price",
        },
      ],
      contractor: null,
      customer: null,
      scope: {
        overviewNarrative: undefined,
        rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Test"] }],
        additionalItems: [],
        existingConditions: undefined,
        accessIssues: undefined,
        inclusions: [],
        exclusions: [],
        materialsMentioned: [],
        materialsSupply: null,
        assumptions: [{ description: "Customer-facing assumption", treatment: "assumed_ok" }],
        timeline: "TBC",
      },
    };

    const document = buildQuotePdfDocument(payload);
    const buffer = await renderToBuffer(document as never);
    const pdfText = buffer.toString("latin1");

    // Contractor-only fields must NOT appear
    expect(pdfText).not.toMatch(/assumption_note/i);
    expect(pdfText).not.toMatch(/CONTRACTOR ONLY/i);
    expect(pdfText).not.toMatch(/check supplier price/i);
    expect(pdfText).not.toMatch(/next_question/i);
    expect(pdfText).not.toMatch(/unasked_required/i);
    expect(pdfText).not.toMatch(/wrap_incomplete/i);
    expect(pdfText).not.toMatch(/contractor_flags/i);

    // Customer-facing assumption should appear
    expect(pdfText).toMatch(/Customer-facing assumption/);
  });

  it("a guest quote with completed in-memory SoW renders scope section", async () => {
    const { draftGuestQuote } = await import("@/lib/guest/quote");
    const { guestQuoteToPdfPayload } = await import("@/lib/guest/pdf");
    const { buildQuotePdfDocument } = await import("@/lib/pdf/quote-payload");
    const { renderToBuffer } = await import("@react-pdf/renderer");

    const sow: SowState = {
      job_type: "rewire",
      rooms: [{ name: "Kitchen", dimensions: "4m x 3m", work_items: ["Install 8 sockets"] }],
      materials_mentioned: ["cable"],
      access_issues: undefined,
      existing_conditions: undefined,
      timeline: "3 days",
      labour_plan: { people_count: 2, duration_days: 3, crew_description: "Team of 2" },
      deadline: null,
      materials_supply: { contractor_supplied: ["cable"], customer_supplied: [] },
      agreed_costs: { day_rate: 340, fixed_price: null, deposit_amount: null, notes: undefined },
      pricing: null,
      inclusions: ["Testing"],
      exclusions: ["Decorating"],
      additional_items: [],
      assumptions_and_unknowns: [],
      customer_name: "Guest Customer",
      site_address: "123 Guest St",
      customer_phone: undefined,
      customer_email: undefined,
      complete: true,
      next_question: undefined,
      overview_narrative: "Guest quote overview",
      reclassification_count: 0,
      used_generic_fallback: false,
      wrap_incomplete: false,
      unasked_required: [],
    };

    // This would be mocked in real scenario, but we test the flow
    const guestQuote = await draftGuestQuote({
      sow,
      reference: "GUEST123",
      createdAt: "2026-08-19T10:00:00Z",
    });

    expect(guestQuote).toBeDefined();

    const payload = guestQuoteToPdfPayload(guestQuote);
    expect(payload.scope).toBeDefined();
    expect(payload.scope?.rooms).toHaveLength(1);

    const document = buildQuotePdfDocument(payload);
    const buffer = await renderToBuffer(document as never);
    const pdfText = buffer.toString("latin1");

    expect(pdfText).toMatch(/Scope of work/i);
    expect(pdfText).toMatch(/Kitchen/);
    expect(pdfText).toMatch(/Install 8 sockets/);
  });

  it("golden test fixtures include fifth 'with-scope' fixture", async () => {
    const { QUOTE_PDF_FIXTURES } = await import("../helpers/quote-pdf-fixtures");

    expect(QUOTE_PDF_FIXTURES).toBeDefined();
    expect(QUOTE_PDF_FIXTURES.length).toBeGreaterThanOrEqual(5);

    const withScopeFixture = QUOTE_PDF_FIXTURES.find((f) => f.key === "with-scope");
    expect(withScopeFixture, "with-scope fixture should exist").toBeDefined();

    // The fixture should have sow_json populated
    const row = withScopeFixture!.row as { job: { sow_json: unknown } };
    expect(row.job.sow_json).toBeDefined();
    expect(row.job.sow_json).not.toBeNull();
  });

  it("the four existing golden fixtures have sow_json = null", async () => {
    const { QUOTE_PDF_FIXTURES } = await import("../helpers/quote-pdf-fixtures");

    const existingFixtures = ["vat-registered-with-logo", "non-vat-no-logo", "footer-terms", "unpriced-labour"];

    for (const key of existingFixtures) {
      const fixture = QUOTE_PDF_FIXTURES.find((f) => f.key === key);
      expect(fixture, `${key} fixture should exist`).toBeDefined();

      const row = fixture!.row as { job: { sow_json?: unknown } };

      // sow_json should either be absent or null for backwards compatibility
      const sowJson = "sow_json" in row.job ? row.job.sow_json : null;
      expect(sowJson, `${key} should have sow_json = null to prove no-scope path unchanged`).toBeNull();
    }
  });

  it("buildQuoteScope accepts crewSizeOverride parameter for timeline synthesis", async () => {
    const { buildQuoteScope } = await import("@/lib/pdf/quote-payload");

    const sow: SowState = {
      job_type: "rewire",
      rooms: [{ name: "Kitchen", dimensions: undefined, work_items: ["Test"] }],
      materials_mentioned: [],
      access_issues: undefined,
      existing_conditions: undefined,
      timeline: undefined,
      labour_plan: { people_count: 1, duration_days: 3, crew_description: undefined },
      deadline: null,
      materials_supply: null,
      agreed_costs: null,
      pricing: null,
      inclusions: [],
      exclusions: [],
      additional_items: [],
      assumptions_and_unknowns: [],
      customer_name: undefined,
      site_address: undefined,
      customer_phone: undefined,
      customer_email: undefined,
      complete: true,
      next_question: undefined,
      overview_narrative: undefined,
      reclassification_count: 0,
      used_generic_fallback: false,
      wrap_incomplete: false,
      unasked_required: [],
    };

    // With crew size override of 2, timeline should reflect 2-person team
    const scope = buildQuoteScope(sow, 2);
    expect(scope?.timeline).toContain("2-person team");

    // Without override, should use labour_plan.people_count
    const scopeNoOverride = buildQuoteScope(sow);
    expect(scopeNoOverride?.timeline).toContain("1-person team");
  });
});
