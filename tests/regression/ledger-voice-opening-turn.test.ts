// Two defects confirmed from a device transcript on 25 Aug 2026, and they turned
// out to be one defect wearing two faces.
//
// The transcript opened with the assistant ANSWERING a question nobody had
// asked — "You're all caught up — no outstanding invoices. That's everything for
// now." — and then REFUSED the contractor's actual question:
//
//   You:    How much money am I owed?
//   Motko:  I can't answer that yet. I can tell you what you're owed, …
//
// It refused the first item on its own list, having volunteered that same answer
// moments earlier.
//
// The cause was in the instructions. They framed the session as "Listen to ONE
// question … Close the session", and the client fires a bare `response.create`
// on channel open to make the assistant speak first. With no opening turn
// defined, the model performed the only job it had been given — answer a
// supported query — burning the single permitted question before the contractor
// spoke. Everything they then asked was, by the prompt's own framing, extra.
//
// So the opening turn is what these tests guard. The refusal was downstream of
// it.
import { describe, expect, it } from "vitest";
import {
  buildLedgerQueryInstructions,
  classifyQuery,
} from "@/lib/voice/ledger-query-prompt";

describe("the opening turn", () => {
  const instructions = buildLedgerQueryInstructions();

  it("tells the model its first turn is a greeting", () => {
    expect(instructions).toMatch(/FIRST turn is a greeting/i);
  });

  it("forbids calling a tool or stating a figure before being asked", () => {
    // The specific failure: the model called get_owed_to_you unprompted and
    // spoke the result. A figure the contractor did not ask for is one they
    // have no reason to doubt and nothing on screen to check against.
    expect(instructions).toMatch(/MUST NOT call any tool/i);
    expect(instructions).toMatch(/MUST NOT state any figure/i);
  });

  it("does not cap the session at one question", () => {
    // "Listen to ONE question" is what made the contractor's real question look
    // like an extra one once the opener had consumed the allowance.
    expect(
      instructions,
      "a one-question cap makes every genuine question the second one",
    ).not.toMatch(/ONE question/);
  });

  it("does not instruct the model to close the session itself", () => {
    // The client never closes the session either — it returns to "listening"
    // after every response. The prompt claiming otherwise is what produced
    // "That's everything for now." as an opening line.
    expect(instructions).not.toMatch(/close the session\b(?!\s*yourself)/i);
  });
});

describe("a question asked in the contractor's own words", () => {
  // The five supported queries are descriptions, not phrases to match
  // literally. Each of these plainly means "what am I owed".
  const owedPhrasings = [
    "How much money am I owed?", // verbatim from the device transcript
    "How much am I owed?",
    "What am I owed?",
    "What's outstanding?",
    "Who owes me?",
  ];

  for (const phrasing of owedPhrasings) {
    it(`classifies "${phrasing}" as what_am_i_owed`, async () => {
      const result = await classifyQuery(phrasing);
      expect(
        result.queryType,
        "refusing query 1 reworded is a failure, not a safe default",
      ).toBe("what_am_i_owed");
    });
  }
});

describe("query 4 is reachable", () => {
  // /send|create|make|update/i was tested BEFORE the what_did_job_make branch,
  // so "make" — the word the query is named after — sent every phrasing of it
  // out of set. No wording could reach the branch below.
  it("classifies a job-profit question rather than excluding it on the word 'make'", async () => {
    const result = await classifyQuery("What did the Smith job make?");
    expect(result.queryType).toBe("what_did_job_make");
  });

  it("still extracts the job identifier", async () => {
    const result = await classifyQuery("What did the Smith job make?");
    expect(result.parameters?.jobIdentifier).toBe("smith");
  });
});

describe("genuinely different questions are still refused", () => {
  // Reordering the classifier must not turn the exclusions off. These are the
  // three cases tests/acceptance/257.test.ts freezes, plus the ledger-changing
  // request that the reorder is most likely to have loosened.
  const outOfSet = [
    "How does this month compare to last month?",
    "Mark Frank's costs as paid",
    "Who's my biggest customer?",
    "Send the Smith invoice",
    "What's my average job worth?",
  ];

  for (const phrasing of outOfSet) {
    it(`refuses "${phrasing}"`, async () => {
      const result = await classifyQuery(phrasing);
      expect(result.queryType).toBe("out_of_set");
    });
  }
});
