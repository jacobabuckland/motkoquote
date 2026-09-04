/**
 * VOICE-4: Integration test for cap_ended flag
 *
 * Invokes completeSowConversation end-to-end with a stubbed Supabase client
 * to verify that cap_ended is correctly set in the persisted SowState based
 * on the wrap_reason value, including the defensive ternary case when
 * wrap_reason is undefined (actions.ts:439).
 *
 * The acceptance tests at 541.test.tsx verify the predicate and schema in
 * isolation and acknowledge they "cannot easily invoke completeSow" — this is
 * where the full integration is proved.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WrapReason, SowState } from "@/lib/schemas/sow";

describe("VOICE-4: cap_ended integration", () => {
  let capturedSowState: SowState | null = null;
  let mockSupabaseClient: unknown;

  beforeEach(() => {
    capturedSowState = null;
    vi.resetModules();

    // Mock user and contractor data
    const mockUser = { id: "00000000-0000-4000-8000-000000000001" };
    const mockContractor = {
      id: "00000000-0000-4000-8000-000000000002",
      company_name: "Test Electrical",
      trade: "electrician",
      vat_registered: true,
      day_rate: 35000,
      overtime_rate: 4500,
      callout_min: 10000,
      travel_rate: 4500,
      markup_pct: 15,
    };

    const mockJob = {
      id: "00000000-0000-4000-8000-000000000003",
      sow_json: {
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
        customer_name: "Test Customer",
        site_address: "123 Test St",
        customer_phone: "+447700900123",
        customer_email: "test@example.com",
        complete: false,
        next_question: undefined,
        overview_narrative: undefined,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: false,
        unasked_required: [],
        stated_prices: [],
        declined_slots: [],
        cap_ended: false,
      },
    };

    // Create a comprehensive mock Supabase client
    mockSupabaseClient = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: mockUser }, error: null })),
      },
      from: vi.fn((table: string) => {
        if (table === "contractors") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({ data: mockContractor, error: null })),
              })),
            })),
          };
        }
        if (table === "jobs") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: mockJob, error: null })),
                })),
                single: vi.fn(async () => ({ data: mockJob, error: null })),
              })),
            })),
            update: vi.fn((data: { sow_json?: SowState }) => {
              // Capture the sowState being written
              if (data.sow_json) {
                capturedSowState = data.sow_json;
              }
              return {
                eq: vi.fn(() => Promise.resolve({ data: mockJob, error: null })),
              };
            }),
          };
        }
        if (table === "team_members") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [], error: null })),
            })),
          };
        }
        if (table === "rate_cards") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(async () => ({ data: [], error: null })),
              })),
            })),
          };
        }
        if (table === "quotes") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: "00000000-0000-4000-8000-000000000004" },
                  error: null,
                })),
              })),
            })),
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: [], error: null })),
                })),
              })),
            })),
          };
        }
        if (table === "line_items") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [], error: null })),
            })),
          };
        }
        // Default mock for any other table
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: [], error: null })),
          })),
        };
      }),
    };

    // Mock the createClient function
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: vi.fn(async () => mockSupabaseClient),
    }));

    // Mock LLM and external calls to return minimal valid responses
    vi.doMock("@/lib/claude", () => ({
      generateSowNarrative: vi.fn(async () => "Test narrative"),
      draftQuoteLineItems: vi.fn(async () => ({
        line_items: [
          {
            category: "labour" as const,
            description: "Test work",
            quantity: 8,
            unit: "hours",
            unit_price: 5000,
            multiplier: 1,
            people_count: 1,
            overtime: false,
            assumed: false,
          },
        ],
        tendencies: {},
      })),
    }));

    vi.doMock("@/lib/knowledge", () => ({
      findSimilarPastJobs: vi.fn(async () => []),
      syncQuoteKnowledge: vi.fn(async () => {}),
      countLearnedQuotes: vi.fn(async () => 0),
    }));

    vi.doMock("@/lib/materials", () => ({
      findKnownMaterialPrices: vi.fn(async () => []),
      rememberMaterialPrices: vi.fn(async () => {}),
    }));

    vi.doMock("@/lib/telemetry", () => ({
      track: vi.fn(async () => {}),
    }));
  });

  it("sets cap_ended: true when wrap_reason is cap_questions", async () => {
    const { completeSowConversation } = await import("@/app/jobs/actions");

    await completeSowConversation({
      jobId: "00000000-0000-4000-8000-000000000003",
      transcript: "Test transcript",
      wrapReason: "cap_questions" as WrapReason,
      questionsAsked: 12,
    });

    expect(capturedSowState).not.toBeNull();
    expect(capturedSowState!.cap_ended).toBe(true);
  });

  it("sets cap_ended: true when wrap_reason is cap_time", async () => {
    const { completeSowConversation } = await import("@/app/jobs/actions");

    await completeSowConversation({
      jobId: "00000000-0000-4000-8000-000000000003",
      transcript: "Test transcript",
      wrapReason: "cap_time" as WrapReason,
      questionsAsked: 8,
    });

    expect(capturedSowState).not.toBeNull();
    expect(capturedSowState!.cap_ended).toBe(true);
  });

  it("sets cap_ended: false when wrap_reason is slots (natural ending)", async () => {
    const { completeSowConversation } = await import("@/app/jobs/actions");

    await completeSowConversation({
      jobId: "00000000-0000-4000-8000-000000000003",
      transcript: "Test transcript",
      wrapReason: "slots" as WrapReason,
      questionsAsked: 5,
    });

    expect(capturedSowState).not.toBeNull();
    expect(capturedSowState!.cap_ended).toBe(false);
  });

  it("sets cap_ended: false when wrap_reason is user (natural ending)", async () => {
    const { completeSowConversation } = await import("@/app/jobs/actions");

    await completeSowConversation({
      jobId: "00000000-0000-4000-8000-000000000003",
      transcript: "Test transcript",
      wrapReason: "user" as WrapReason,
      questionsAsked: 6,
    });

    expect(capturedSowState).not.toBeNull();
    expect(capturedSowState!.cap_ended).toBe(false);
  });

  it("sets cap_ended: false when wrap_reason is manual (natural ending)", async () => {
    const { completeSowConversation } = await import("@/app/jobs/actions");

    await completeSowConversation({
      jobId: "00000000-0000-4000-8000-000000000003",
      transcript: "Test transcript",
      wrapReason: "manual" as WrapReason,
      questionsAsked: 3,
    });

    expect(capturedSowState).not.toBeNull();
    expect(capturedSowState!.cap_ended).toBe(false);
  });

  it("sets cap_ended: false when wrap_reason is undefined (defensive ternary at actions.ts:439)", async () => {
    const { completeSowConversation } = await import("@/app/jobs/actions");

    // Call without wrapReason — this exercises the ternary:
    // cap_ended: wrapReason ? endedOnCap(wrapReason) : false
    await completeSowConversation({
      jobId: "00000000-0000-4000-8000-000000000003",
      transcript: "Test transcript",
      // wrapReason omitted
    });

    expect(capturedSowState).not.toBeNull();
    expect(capturedSowState!.cap_ended).toBe(false);
  });

  it("preserves other SowState fields while setting cap_ended", async () => {
    const { completeSowConversation } = await import("@/app/jobs/actions");

    await completeSowConversation({
      jobId: "00000000-0000-4000-8000-000000000003",
      transcript: "Test transcript",
      wrapReason: "cap_time" as WrapReason,
      questionsAsked: 10,
    });

    expect(capturedSowState).not.toBeNull();
    // Verify cap_ended is set correctly
    expect(capturedSowState!.cap_ended).toBe(true);
    // Verify other fields are preserved
    expect(capturedSowState!.job_type).toBe("rewire");
    expect(capturedSowState!.customer_name).toBe("Test Customer");
    expect(capturedSowState!.complete).toBe(true);
  });

  it("allows both cap_ended and wrap_incomplete to be true simultaneously", async () => {
    // Pass unaskedRequired to trigger wrap_incomplete AND a capped wrap_reason
    // to trigger cap_ended. This proves both flags can be true at once.
    const { completeSowConversation } = await import("@/app/jobs/actions");

    await completeSowConversation({
      jobId: "00000000-0000-4000-8000-000000000003",
      transcript: "Test transcript",
      wrapReason: "cap_questions" as WrapReason,
      questionsAsked: 12,
      unaskedRequired: ["crew"], // This will make wrap_incomplete true
    });

    expect(capturedSowState).not.toBeNull();
    // Both flags should be true
    expect(capturedSowState!.cap_ended).toBe(true);
    expect(capturedSowState!.wrap_incomplete).toBe(true);
    expect(capturedSowState!.unasked_required).toContain("crew");
  });
});
