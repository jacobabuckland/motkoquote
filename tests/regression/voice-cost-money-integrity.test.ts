import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LED-5 money-integrity rule (#258).
 *
 * The spec's non-negotiable rule: a spoken amount is parsed to integer pence
 * by deterministic code from the contractor's own words, never taken from a
 * model-authored number field. These tests bind both halves of that —
 * the model is given no field to author a figure in, and the write path
 * computes the amount rather than accepting one.
 */

describe("draft_cost tool schema", () => {
  it("gives the model no field in which to author an amount", async () => {
    const { COST_INTAKE_TOOLS } = await import("@/lib/voice/cost-intake-prompt");

    const draftCost = COST_INTAKE_TOOLS.find((t) => t.name === "draft_cost");
    expect(draftCost).toBeDefined();

    const params = draftCost!.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };

    // A model-authored pence field is the defect: once it exists, whatever
    // validation sits behind it, the number on the confirmation screen is the
    // model's. Its absence is the guarantee.
    expect(Object.keys(params.properties)).not.toContain("amount_pence");
    expect(params.required).not.toContain("amount_pence");

    // The words are what the model is for, and they are mandatory.
    expect(params.properties).toHaveProperty("amount_words");
    expect(params.required).toContain("amount_words");
  });
});

describe("buildDraftFromToolArgs (the client's drafting decision)", () => {
  const args = {
    amount_words: "two hundred and eighty pounds",
    counterparty_name: "Screwfix",
    category: "materials" as const,
    job_spoken_words: "the Henderson job",
    description: "Materials from Screwfix",
  };

  // #274: the job is matched from these, never supplied by the model.
  const jobs = [
    { id: "job-1", customer_name: "Henderson", created_at: "2026-08-17T09:00:00Z" },
    { id: "job-2", customer_name: "Okafor", created_at: "2026-08-10T09:00:00Z" },
  ];

  it("derives the confirmed figure from the words, not from the model", async () => {
    const { buildDraftFromToolArgs } = await import("@/lib/voice/draft-cost");

    const outcome = buildDraftFromToolArgs(args, "2026-08-18", jobs);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 28000 appears nowhere in the input. It exists only because the parser
    // computed it — which is the whole of the money-integrity rule.
    expect(outcome.draft.amountPence).toBe(28000);
    expect(outcome.draft.amountWords).toBe("two hundred and eighty pounds");
  });

  it("drafts nothing when the words carry no parseable amount", async () => {
    const { buildDraftFromToolArgs } = await import("@/lib/voice/draft-cost");

    const outcome = buildDraftFromToolArgs(
      { ...args, amount_words: "um yeah so materials and stuff" },
      "2026-08-18",
      jobs,
    );

    // No draft at all — so no figure is shown for confirmation, and the model
    // is told to go back and ask.
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/could not parse amount/i);
  });

  it("is pure — the same words always draft the same amount", async () => {
    const { buildDraftFromToolArgs } = await import("@/lib/voice/draft-cost");

    const a = buildDraftFromToolArgs(args, "2026-08-18", jobs);
    const b = buildDraftFromToolArgs(args, "2026-08-18", jobs);

    expect(a).toEqual(b);
  });
});

// Observes what actually reached the ledger, so "it wrote the right figure"
// is read off the write rather than inferred from the absence of a throw.
let written: { amountNet: number } | null = null;

const runCapture = async (params: { amountWords: string }) => {
  written = null;
  vi.resetModules();

  const chain = (table: string): Record<string, unknown> => ({
    select: () => chain(table),
    eq: () => chain(table),
    maybeSingle: async () => ({ data: rowFor(table), error: null }),
  });

  const rowFor = (table: string): unknown => {
    if (table === "jobs") {
      return {
        id: "job-1",
        contractor_id: "contractor-1",
        customer_name: "Henderson",
        job_reference: "MK-1234",
      };
    }
    if (table === "contractors") return { id: "contractor-1" };
    return null;
  };

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => chain(table),
    }),
  }));
  vi.doMock("@/app/jobs/[id]/cost-actions", () => ({
    createJobCost: async (input: { amountNet: number }) => {
      written = { amountNet: input.amountNet };
      return { ok: true as const, id: "cost-1" };
    },
  }));
  vi.doMock("next/navigation", () => ({ redirect: () => {} }));

  const { completeCostCapture } = await import("@/app/costs/actions");
  return completeCostCapture({
    jobId: "job-1",
    counterpartyName: "Screwfix",
    category: "materials",
    description: "Materials from Screwfix",
    incurredOn: "2026-08-18",
    ...params,
  });
};

describe("completeCostCapture money integrity", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("takes only words, and writes the amount it parses from them itself", async () => {
    // The action's own parse is what reaches the ledger. It accepts no figure
    // to take instead — the client cannot hand it one, and neither can the
    // model behind the client.
    await runCapture({ amountWords: "two hundred and eighty pounds" });

    expect(written).toEqual({ amountNet: 28000 });
  });

  it("refuses the write when the words cannot be parsed at all", async () => {
    // No figure exists to fall back to, by design, so an unparseable phrase
    // writes nothing rather than writing a guess.
    await expect(
      runCapture({ amountWords: "um yeah so materials and stuff" }),
    ).rejects.toThrow(/could not parse amount/i);

    expect(written).toBeNull();
  });

  it("refuses an amount outside the permitted range", async () => {
    await expect(
      runCapture({ amountWords: "2000000 pounds" }),
    ).rejects.toThrow(/between/i);

    expect(written).toBeNull();
  });
});
