/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TranscriptTurn } from "@/lib/voice-transcript";
import type { SowState } from "@/lib/schemas/sow";
import type { JobExtraction, LineItem } from "@/lib/schemas/job";

// Required cleanup since vitest config does not set globals: true
afterEach(cleanup);

describe("OBS-3: Run viewer shows where a value died", () => {
  // The page component under test
  let RunPage: React.ComponentType<{ params: Promise<{ id: string }> }>;

  beforeEach(async () => {
    // Import the page component
    const mod = await import("@/app/jobs/[id]/run/page");
    RunPage = mod.default;
  });

  it("exists as a module with a default export", async () => {
    const mod = await import("@/app/jobs/[id]/run/page");
    expect(mod.default).toBeDefined();
  });

  it("displays all six pipeline panes for a complete voice run", async () => {
    // Mock the data-fetching calls
    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: "Customer: I need 10 sockets.\nAssistant: Understood, 10 sockets.",
      conversation_json: [
        { speaker: "contractor", text: "I need 10 sockets", at: "2026-09-01T10:00:00Z" },
        { speaker: "assistant", text: "Understood, 10 sockets", at: "2026-09-01T10:00:05Z" },
      ] as TranscriptTurn[],
      sow_json: {
        job_type: "electrical",
        rooms: [{ name: "Kitchen", dimensions: "4m x 3m", work_items: ["Install 10 sockets"] }],
        materials_mentioned: ["sockets"],
        access_issues: null,
        existing_conditions: null,
        timeline: null,
        labour_plan: null,
        deadline: null,
        materials_supply: null,
        agreed_costs: null,
        customer_name: "John Doe",
        customer_contact: "07700900000",
        site_address: "123 Test St",
        inclusions: [],
        exclusions: [],
        assumptions: [],
        unasked_required: [],
        declined_slots: [],
        stated_prices: [
          {
            amount: 8500,
            item: "sockets",
            transcript_span: "I need 10 sockets",
            qualifiers: { each: true, fitted: false, already_paid: false, excluded: false },
            superseded_by: null,
          },
        ],
      } as SowState,
      extracted_json: {
        job_type: "electrical",
        scope_items: ["Install 10 sockets"],
        additional_items: [],
        dimensions: null,
        materials_mentioned: ["sockets"],
        access_issues: null,
        timeline: null,
        notes: null,
        crew_description: null,
        materials_supply: null,
      } as JobExtraction,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => ({
      id: "quote-1",
      job_id: "job-1",
      drafted_line_items_json: [
        {
          description: "Install 10 sockets",
          category: "labour" as const,
          quantity: 1,
          unit: "day",
          unit_price: 34000,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
          provenance: {
            source: "transcript" as const,
            transcript_span: "I need 10 sockets",
          },
        },
      ] as LineItem[],
      line_items_json: [
        {
          description: "Install 10 sockets",
          category: "labour" as const,
          quantity: 1,
          unit: "day",
          unit_price: 34000,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
          provenance: {
            source: "transcript" as const,
            transcript_span: "I need 10 sockets",
          },
        },
      ] as LineItem[],
      contractor_flags_json: [] as string[],
    }));

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    // Mock the imports (this would typically be done with module mocking)
    vi.mock("@/app/jobs/actions", () => ({
      getJob: mockGetJob,
    }));

    vi.mock("@/app/quotes/actions", () => ({
      getQuote: mockGetQuote,
    }));

    vi.mock("@/lib/auth", () => ({
      getCurrentContractor: mockGetCurrentContractor,
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    // Wait for the async page to render
    await screen.findByText(/conversation turns/i);

    // Assert all six panes are present
    expect(screen.getByText(/conversation turns/i)).toBeDefined();
    expect(screen.getByText(/flat transcript/i)).toBeDefined();
    expect(screen.getByText(/sow state/i)).toBeDefined();
    expect(screen.getByText(/extraction/i)).toBeDefined();
    expect(screen.getByText(/drafted line items/i)).toBeDefined();
    expect(screen.getByText(/final line items/i)).toBeDefined();

    // Assert conversation content is visible
    expect(screen.getByText(/I need 10 sockets/i)).toBeDefined();

    // Assert stated price is visible in SoW pane
    expect(screen.getByText(/£85.00/)).toBeDefined();
  });

  it("displays provenance source for each line item", async () => {
    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: "Customer: I need rewiring.",
      conversation_json: [],
      sow_json: null,
      extracted_json: null,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => ({
      id: "quote-1",
      job_id: "job-1",
      drafted_line_items_json: [
        {
          description: "Rewiring",
          category: "labour" as const,
          quantity: 3,
          unit: "day",
          unit_price: 34000,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
          provenance: {
            source: "transcript" as const,
            transcript_span: "I need rewiring",
          },
        },
        {
          description: "Additional material",
          category: "materials" as const,
          quantity: 1,
          unit: "item",
          unit_price: 5000,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
          provenance: {
            source: "contractor" as const,
          },
        },
      ] as LineItem[],
      line_items_json: [],
      contractor_flags_json: [],
    }));

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    await screen.findByText(/drafted line items/i);

    // Assert transcript-sourced line shows its span
    expect(screen.getByText(/transcript/i)).toBeDefined();
    expect(screen.getByText(/I need rewiring/)).toBeDefined();

    // Assert contractor-sourced line is labeled
    expect(screen.getByText(/contractor/i)).toBeDefined();
  });

  it("shows empty state for job with no voice run", async () => {
    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: null,
      conversation_json: null,
      sow_json: null,
      extracted_json: null,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => null);

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    await screen.findByText(/no voice run/i);

    expect(screen.getByText(/no voice run for this job/i)).toBeDefined();
    expect(screen.getByText(/created manually/i)).toBeDefined();
  });

  it("shows partial panes for job abandoned mid-call", async () => {
    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: "Customer: I need a bathroom refit.",
      conversation_json: [
        { speaker: "contractor", text: "I need a bathroom refit", at: "2026-09-01T10:00:00Z" },
      ] as TranscriptTurn[],
      sow_json: {
        job_type: "bathroom",
        rooms: [{ name: "Bathroom", dimensions: null, work_items: ["refit"] }],
        materials_mentioned: [],
        access_issues: null,
        existing_conditions: null,
        timeline: null,
        labour_plan: null,
        deadline: null,
        materials_supply: null,
        agreed_costs: null,
        customer_name: null,
        customer_contact: null,
        site_address: null,
        inclusions: [],
        exclusions: [],
        assumptions: [],
        unasked_required: [],
        declined_slots: [],
        stated_prices: [],
      } as SowState,
      extracted_json: null, // Pipeline stopped here
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => null);

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    await screen.findByText(/conversation turns/i);

    // First three panes should be present
    expect(screen.getByText(/conversation turns/i)).toBeDefined();
    expect(screen.getByText(/flat transcript/i)).toBeDefined();
    expect(screen.getByText(/sow state/i)).toBeDefined();

    // Later panes should show "did not reach" message
    expect(screen.getByText(/pipeline did not reach this stage/i)).toBeDefined();
  });

  it("labels fixed-mode pricing collapse correctly in draft-vs-final comparison", async () => {
    const draftedItems: LineItem[] = [
      {
        description: "Labour",
        category: "labour",
        quantity: 3,
        unit: "day",
        unit_price: 34000,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      },
      {
        description: "Materials",
        category: "materials",
        quantity: 1,
        unit: "item",
        unit_price: 50000,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      },
    ];

    const finalItems: LineItem[] = [
      {
        description: "Complete works",
        category: "labour",
        quantity: 1,
        unit: "job",
        unit_price: 152000,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      },
    ];

    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: "test",
      conversation_json: [],
      sow_json: null,
      extracted_json: null,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => ({
      id: "quote-1",
      job_id: "job-1",
      drafted_line_items_json: draftedItems,
      line_items_json: finalItems,
      contractor_flags_json: [],
    }));

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    await screen.findByText(/draft.*final.*comparison/i);

    // Assert the collapse is labeled as such, not as deletions
    expect(screen.getByText(/collapsed to single works line/i)).toBeDefined();
    expect(screen.getByText(/fixed pricing mode/i)).toBeDefined();
  });

  it("handles legacy conversation turns without 'at' timestamp", async () => {
    const legacyTurns = [
      { speaker: "contractor", text: "Legacy turn without timestamp" },
    ] as unknown as TranscriptTurn[];

    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: "Legacy turn without timestamp",
      conversation_json: legacyTurns,
      sow_json: null,
      extracted_json: null,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => null);

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    await screen.findByText(/conversation turns/i);

    // Assert the legacy turn renders without crashing
    expect(screen.getByText(/legacy turn without timestamp/i)).toBeDefined();
  });

  it("enforces contractor scoping (403 for other contractor's job)", async () => {
    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-2", // Different contractor
      transcript: "test",
      conversation_json: [],
      sow_json: null,
      extracted_json: null,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => null);

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1", // Current user
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    // Should show 403 / access denied message
    await screen.findByText(/forbidden|access denied|not authorized/i);

    expect(screen.getByText(/forbidden|access denied|not authorized/i)).toBeDefined();
  });

  it("uses scrollable containers for very long transcripts", async () => {
    // Create a very long transcript (500 turns)
    const longConversation: TranscriptTurn[] = Array.from({ length: 500 }, (_, i) => ({
      speaker: (i % 2 === 0 ? "contractor" : "assistant") as "contractor" | "assistant",
      text: `Turn ${i + 1} text`,
      at: `2026-09-01T10:${String(i % 60).padStart(2, "0")}:00Z`,
    }));

    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: longConversation.map((t) => t.text).join("\n"),
      conversation_json: longConversation,
      sow_json: null,
      extracted_json: null,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => null);

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    await screen.findByText(/conversation turns/i);

    // Find the container for conversation turns
    const conversationPane = screen.getByText(/conversation turns/i).closest("div");

    // Assert it has overflow styles (the exact class may vary)
    expect(conversationPane?.className).toMatch(/overflow|scroll/);
  });

  it("displays stated price with no item attachment", async () => {
    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: "It'll cost about £500",
      conversation_json: [],
      sow_json: {
        job_type: "general",
        rooms: [],
        materials_mentioned: [],
        access_issues: null,
        existing_conditions: null,
        timeline: null,
        labour_plan: null,
        deadline: null,
        materials_supply: null,
        agreed_costs: null,
        customer_name: null,
        customer_contact: null,
        site_address: null,
        inclusions: [],
        exclusions: [],
        assumptions: [],
        unasked_required: [],
        declined_slots: [],
        stated_prices: [
          {
            amount: 50000,
            item: null, // No item attachment
            transcript_span: "It'll cost about £500",
            qualifiers: { each: false, fitted: false, already_paid: false, excluded: false },
            superseded_by: null,
          },
        ],
      } as SowState,
      extracted_json: null,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => null);

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    await screen.findByText(/sow state/i);

    // Assert the stated price is shown with "(no item)"
    expect(screen.getByText(/£500\.00/)).toBeDefined();
    expect(screen.getByText(/\(no item\)/i)).toBeDefined();
  });

  it("displays contractor flags in final line items pane", async () => {
    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: "test",
      conversation_json: [],
      sow_json: null,
      extracted_json: null,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => ({
      id: "quote-1",
      job_id: "job-1",
      drafted_line_items_json: [],
      line_items_json: [],
      contractor_flags_json: [
        "Warning: Customer mentioned asbestos",
        "Note: Site access restricted on weekends",
      ] as string[],
    }));

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    await screen.findByText(/final line items/i);

    // Assert contractor flags are visible
    expect(screen.getByText(/customer mentioned asbestos/i)).toBeDefined();
    expect(screen.getByText(/site access restricted on weekends/i)).toBeDefined();
  });

  it("shows work items from SoW rooms", async () => {
    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: "test",
      conversation_json: [],
      sow_json: {
        job_type: "electrical",
        rooms: [
          {
            name: "Kitchen",
            dimensions: "4m x 3m",
            work_items: ["Install 10 sockets", "Replace consumer unit", "Test and certify"],
          },
          {
            name: "Living room",
            dimensions: null,
            work_items: ["Add 5 downlights"],
          },
        ],
        materials_mentioned: [],
        access_issues: null,
        existing_conditions: null,
        timeline: null,
        labour_plan: null,
        deadline: null,
        materials_supply: null,
        agreed_costs: null,
        customer_name: null,
        customer_contact: null,
        site_address: null,
        inclusions: [],
        exclusions: [],
        assumptions: [],
        unasked_required: [],
        declined_slots: [],
        stated_prices: [],
      } as SowState,
      extracted_json: null,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => null);

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    await screen.findByText(/sow state/i);

    // Assert room names and work items are visible
    expect(screen.getByText(/kitchen/i)).toBeDefined();
    expect(screen.getByText(/install 10 sockets/i)).toBeDefined();
    expect(screen.getByText(/replace consumer unit/i)).toBeDefined();
    expect(screen.getByText(/test and certify/i)).toBeDefined();
    expect(screen.getByText(/living room/i)).toBeDefined();
    expect(screen.getByText(/add 5 downlights/i)).toBeDefined();
  });

  it("can identify where a stated price was lost in under 30 seconds", async () => {
    // This is the core use case: a stated price appears in SoW but not in final quote
    const mockGetJob = vi.fn(async (_id?: string) => ({
      id: "job-1",
      contractor_id: "contractor-1",
      transcript: "Customer: It's £5000 for the materials, already paid.",
      conversation_json: [],
      sow_json: {
        job_type: "building",
        rooms: [],
        materials_mentioned: ["bricks", "cement"],
        access_issues: null,
        existing_conditions: null,
        timeline: null,
        labour_plan: null,
        deadline: null,
        materials_supply: null,
        agreed_costs: null,
        customer_name: null,
        customer_contact: null,
        site_address: null,
        inclusions: [],
        exclusions: [],
        assumptions: [],
        unasked_required: [],
        declined_slots: [],
        stated_prices: [
          {
            amount: 500000,
            item: "materials",
            transcript_span: "It's £5000 for the materials",
            qualifiers: { each: false, fitted: false, already_paid: true, excluded: false },
            superseded_by: null,
          },
        ],
      } as SowState,
      extracted_json: {
        job_type: "building",
        scope_items: ["Build wall"],
        additional_items: [],
        dimensions: null,
        materials_mentioned: ["bricks", "cement"],
        access_issues: null,
        timeline: null,
        notes: "Materials already paid by customer",
        crew_description: null,
        materials_supply: null,
      } as JobExtraction,
    }));

    const mockGetQuote = vi.fn(async (_jobId?: string) => ({
      id: "quote-1",
      job_id: "job-1",
      drafted_line_items_json: [
        {
          description: "Build wall",
          category: "labour" as const,
          quantity: 2,
          unit: "day",
          unit_price: 34000,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
        },
      ] as LineItem[],
      line_items_json: [
        {
          description: "Build wall",
          category: "labour" as const,
          quantity: 2,
          unit: "day",
          unit_price: 34000,
          multiplier: 1,
          people_count: 1,
          overtime: false,
          assumed: false,
        },
      ] as LineItem[],
      contractor_flags_json: ["Customer already paid £5000 for materials"] as string[],
    }));

    const mockGetCurrentContractor = vi.fn(async () => ({
      id: "contractor-1",
    }));

    render(<RunPage params={Promise.resolve({ id: "job-1" })} />);

    await screen.findByText(/sow state/i);

    // User can see:
    // 1. SoW pane shows stated price of £5000 with "already_paid: true"
    expect(screen.getByText(/£5000\.00/)).toBeDefined();
    expect(screen.getByText(/already paid/i)).toBeDefined();

    // 2. Extraction pane shows the note about materials already paid
    expect(screen.getByText(/materials already paid by customer/i)).toBeDefined();

    // 3. Final line items pane shows NO £5000 line, but a contractor flag explains why
    expect(screen.getByText(/customer already paid £5000 for materials/i)).toBeDefined();

    // Conclusion: the stated price was correctly excluded due to already_paid qualifier,
    // and the contractor flag documents this. Loss point identified.
  });
});
