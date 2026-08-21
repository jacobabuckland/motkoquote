import { describe, it, expect, vi } from "vitest";

// V1: the live job-intake prompt must carry no retrieved past-job context.
//
// It used to. `createRealtimeSession` called
// findSimilarPastJobs(contractor.id, contractor.trade) at session start and
// injected the result. At that moment the job does not exist, so the only query
// text available is the bare trade name, and match_knowledge_chunks applies no
// similarity floor — three whole priced quotes came back unconditionally once
// three chunks existed. The agent then reproduced their line items, treated
// required slots as answered, and skipped the questions it exists to ask. The
// chunk pool grows with every completed quote, so this degraded over time with
// no deploy behind it.
//
// These guard the removal, not the wording: the assembly must stay pure, and it
// must stay pure for the guest path too.

const h = vi.hoisted(() => {
  const findSimilarPastJobs = vi.fn(async () => ["Job type: downlights\nScope: 12 downlights"]);
  const embedText = vi.fn(async () => new Array(1536).fill(0));

  const contractor = { id: "c-1", trade: "Electrician", first_name: "Dave" };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.insert = () => b;
      b.single = () =>
        Promise.resolve({
          data: table === "contractors" ? contractor : { id: "job-1" },
          error: null,
        });
      return b;
    },
  };

  // Signature declared rather than inferred, so mock.calls[0][0] is reachable
  // and typed (AGENTS.md — an inferred zero-arg mock loses the argument).
  const createRealtimeClientSecret = vi.fn<
    (config: { instructions: string; tools: unknown[] }) => Promise<string>
  >(async () => "secret-123");

  return { findSimilarPastJobs, embedText, client, createRealtimeClientSecret };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/knowledge", () => ({
  findSimilarPastJobs: h.findSimilarPastJobs,
  syncQuoteKnowledge: vi.fn(),
}));
vi.mock("@/lib/embeddings", () => ({ embedText: h.embedText }));
vi.mock("@/lib/realtime", () => ({ createRealtimeClientSecret: h.createRealtimeClientSecret }));
vi.mock("@/lib/materials", () => ({ rememberMaterialPrices: vi.fn(), findKnownMaterialPrices: vi.fn() }));
vi.mock("@/lib/claude", () => ({ generateSowNarrative: vi.fn(), draftQuoteLineItems: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(async () => {}), logError: vi.fn(async () => {}) }));

import { buildJobIntakeInstructions } from "@/lib/voice/job-intake-prompt";
import { createRealtimeSession } from "@/app/jobs/actions";

// The marker the injected block always carried. Asserting on it rather than on
// the chunk text keeps this honest if the wording of a chunk ever changes.
const RETRIEVAL_MARKER = /Known context about this contractor/i;

describe("V1 — intake instructions carry no retrieved past-job context", () => {
  it("omits the retrieval block on the signed-in path", () => {
    const instructions = buildJobIntakeInstructions({
      firstName: "Dave",
      trade: "Electrician",
      includeAccountTools: true,
    });

    expect(instructions).not.toMatch(RETRIEVAL_MARKER);
  });

  it("omits the retrieval block on the guest path", () => {
    expect(buildJobIntakeInstructions()).not.toMatch(RETRIEVAL_MARKER);
  });

  it("still carries the must-ask pricing slots on both paths", () => {
    // The removal must not take the invariant with it (CLAUDE.md): crew,
    // pricing mode and materials supply are asked, never inferred.
    for (const instructions of [
      buildJobIntakeInstructions({ trade: "Electrician", includeAccountTools: true }),
      buildJobIntakeInstructions(),
    ]) {
      expect(instructions).toMatch(/The pricing question in particular is not optional/);
      expect(instructions).toMatch(/crew, how it's priced, and materials/);
    }
  });

  it("assembles instructions without any database or embedding call", async () => {
    h.findSimilarPastJobs.mockClear();
    h.embedText.mockClear();

    await createRealtimeSession();

    // The whole defect in one assertion: session start no longer retrieves.
    expect(h.findSimilarPastJobs).not.toHaveBeenCalled();
    expect(h.embedText).not.toHaveBeenCalled();
  });

  it("mints the same instructions whatever the contractor's chunk history holds", async () => {
    // A contractor with 50 chunks and one with none must get byte-identical
    // instructions for the same job — that is what makes the prompt diffable
    // when the next regression lands.
    h.findSimilarPastJobs.mockResolvedValueOnce(
      new Array(50).fill("Job type: rewire\nScope: full house\nLine items:\nFirst fix: 5 day @ £280"),
    );
    h.createRealtimeClientSecret.mockClear();
    await createRealtimeSession();
    const withFullHistory = h.createRealtimeClientSecret.mock.calls[0][0].instructions;

    h.findSimilarPastJobs.mockResolvedValueOnce([]);
    h.createRealtimeClientSecret.mockClear();
    await createRealtimeSession();
    const withNoHistory = h.createRealtimeClientSecret.mock.calls[0][0].instructions;

    expect(withFullHistory).toBe(withNoHistory);
    expect(withFullHistory).not.toMatch(RETRIEVAL_MARKER);
  });
});
