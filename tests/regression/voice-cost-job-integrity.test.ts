/**
 * #274 — the job is matched, never asserted by the model.
 *
 * `matchJobBySpokenReference` shipped with 22 unit tests and no callers. At
 * runtime the model chose `job_id` from a list in the prompt, the client took
 * it as given, and `completeCostCapture` validated only that the job BELONGED
 * to the contractor — never that it was the one they meant.
 *
 * The failure that leaves open is a *valid* job of the contractor's, but the
 * wrong one: two "Smith" jobs, "the Smith job", ownership passes, the cost
 * lands, nothing asks. Money on the wrong job's P&L, silently, which LED-2 and
 * LED-4 then report with confidence.
 *
 * This is the money-integrity rule one field over — "the model may propose
 * structure, code computes and validates" — and these tests bind both halves of
 * it the same way #258's do for amounts: the model is given no field to author
 * a job id in, and the draft path resolves the job itself.
 */

import { describe, expect, it } from "vitest";

import {
  buildDraftFromToolArgs,
  type DraftCostToolArgs,
} from "@/lib/voice/draft-cost";

const jobs = [
  { id: "job-smith-1", customer_name: "Smith", created_at: "2026-08-17T09:00:00Z" },
  { id: "job-smith-2", customer_name: "Smith", created_at: "2026-08-02T09:00:00Z" },
  { id: "job-okafor", customer_name: "Okafor", created_at: "2026-08-10T09:00:00Z" },
];

const args = (overrides: Partial<DraftCostToolArgs> = {}): DraftCostToolArgs => ({
  amount_words: "two hundred and eighty pounds",
  counterparty_name: "Screwfix",
  category: "materials",
  job_spoken_words: "the Okafor job",
  description: "Materials from Screwfix",
  ...overrides,
});

describe("the model has no field in which to author a job id", () => {
  it("does not expose job_id or job_display on the tool", async () => {
    // The structural half. An ambiguous reference cannot resolve to a guess
    // because there is nothing for a guess to travel in — the same reason
    // #258 removed `amount_pence` rather than validating it.
    const { COST_INTAKE_TOOLS } = await import("@/lib/voice/cost-intake-prompt");
    const draftCost = COST_INTAKE_TOOLS.find((t) => t.name === "draft_cost");
    const params = draftCost!.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(Object.keys(params.properties)).not.toContain("job_id");
    expect(Object.keys(params.properties)).not.toContain("job_display");
    expect(params.required).not.toContain("job_id");
  });

  it("asks the model for the contractor's words instead", async () => {
    const { COST_INTAKE_TOOLS } = await import("@/lib/voice/cost-intake-prompt");
    const draftCost = COST_INTAKE_TOOLS.find((t) => t.name === "draft_cost");
    const params = draftCost!.parameters as {
      properties: Record<string, { description?: string }>;
      required: string[];
    };

    expect(params.required).toContain("job_spoken_words");
    expect(params.properties.job_spoken_words?.description).toMatch(/verbatim|own words/i);
  });

  it("tells the model not to resolve the reference itself", async () => {
    const { buildCostIntakeInstructions } = await import("@/lib/voice/cost-intake-prompt");
    const instructions = buildCostIntakeInstructions({
      contractorName: "Sparks Ltd",
      jobs: jobs.map((j) => ({ ...j })),
    });

    expect(instructions).toMatch(/do not pick a job from the list/i);
  });
});

describe("the draft resolves the job deterministically", () => {
  it("matches an unambiguous customer name to its id", () => {
    const outcome = buildDraftFromToolArgs(args(), "2026-08-18", jobs);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.draft.jobId).toBe("job-okafor");
    expect(outcome.draft.jobDisplay).toBe("Okafor");
  });

  it("REFUSES to draft when two jobs share the spoken name", () => {
    // The defect, exactly. Under the old shape the model picked one of these
    // and the cost landed on it.
    const outcome = buildDraftFromToolArgs(
      args({ job_spoken_words: "the Smith job" }),
      "2026-08-18",
      jobs,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/more than one job/i);
  });

  it("says something different when nothing matches", () => {
    // "No job matched" and "several matched" need opposite follow-up questions.
    // Collapsing them is how an agent asks a contractor to repeat a name it
    // heard perfectly well.
    const outcome = buildDraftFromToolArgs(
      args({ job_spoken_words: "the Villanueva job" }),
      "2026-08-18",
      jobs,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/no job matches/i);
    expect(outcome.error).not.toMatch(/more than one/i);
  });

  it("resolves a recency phrase to the newest job", () => {
    const outcome = buildDraftFromToolArgs(
      args({ job_spoken_words: "the last job" }),
      "2026-08-18",
      jobs,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.draft.jobId).toBe("job-smith-1");
  });

  it("drafts nothing when the contractor named no job", () => {
    const outcome = buildDraftFromToolArgs(
      args({ job_spoken_words: undefined }),
      "2026-08-18",
      jobs,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/job_spoken_words/);
  });

  it("drafts nothing when the contractor has no jobs at all", () => {
    const outcome = buildDraftFromToolArgs(args(), "2026-08-18", []);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/no job matches/i);
  });

  it("never returns a job id that is not one of the supplied jobs", () => {
    // The property that makes ownership validation downstream a backstop rather
    // than the only line of defence.
    for (const spoken of ["the Okafor job", "Smith", "the last job", "nonsense"]) {
      const outcome = buildDraftFromToolArgs(
        args({ job_spoken_words: spoken }),
        "2026-08-18",
        jobs,
      );
      if (!outcome.ok) continue;
      expect(jobs.map((j) => j.id)).toContain(outcome.draft.jobId);
    }
  });

  it("is pure — the same words always resolve to the same job", () => {
    const a = buildDraftFromToolArgs(args(), "2026-08-18", jobs);
    const b = buildDraftFromToolArgs(args(), "2026-08-18", jobs);
    expect(a).toEqual(b);
  });
});

describe("the matcher is no longer dead code", () => {
  it("is called by the draft path", async () => {
    // The whole finding was "22 passing tests over a function nothing calls,
    // which read as coverage of shipped behaviour and were not". This asserts
    // the wiring rather than the function, so it fails if someone unwires it
    // and leaves the unit tests passing.
    const outcome = buildDraftFromToolArgs(
      args({ job_spoken_words: "SMITH" }),
      "2026-08-18",
      [jobs[0]!],
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Case-insensitivity is the matcher's behaviour, not the draft path's.
    // Getting it here proves the call happened.
    expect(outcome.draft.jobId).toBe("job-smith-1");
  });
});
