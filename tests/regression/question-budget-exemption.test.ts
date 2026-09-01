import { describe, it, expect } from "vitest";
import {
  BASE_REALTIME_TOOLS,
  MAX_SOW_TURNS,
  buildJobIntakeInstructions,
} from "@/lib/voice/job-intake-prompt";

// V3: the question budget covers discretionary follow-ups only.
//
// Three decisions are bound here, because each is prompt copy and prompt copy
// is easy to "tidy" back into the shape that caused the defect:
//
//   1. The required slots sit outside MAX_SOW_TURNS. There are now four of
//      them — D12 promoted the working dates — so these match on the invariant
//      rather than on the count, which is what made them brittle to a slot
//      being added.
//   2. The infer-rather-than-interrogate licence is scoped to discretionary
//      detail and explicitly withheld from the required slots.
//   3. A spent budget does not excuse an unasked required slot.
//
// These assert the rules are present and paired, not their exact wording —
// enough to catch a removal, loose enough to survive a rewrite that keeps them.

const instructions = buildJobIntakeInstructions({
  trade: "Electrician",
  includeAccountTools: true,
});
const guestInstructions = buildJobIntakeInstructions();

describe("V3 — mandatory slots are exempt from the question budget", () => {
  it("scopes the budget to discretionary questions rather than all questions", () => {
    for (const text of [instructions, guestInstructions]) {
      expect(text).toMatch(
        new RegExp(`Never ask more than ${MAX_SOW_TURNS} discretionary questions`),
      );
      // The old phrasing capped every question, required ones included.
      expect(text).not.toMatch(
        new RegExp(`more than ${MAX_SOW_TURNS} questions total`),
      );
    }
  });

  it("places the required slots and customer details outside the budget", () => {
    for (const text of [instructions, guestInstructions]) {
      expect(text).toMatch(/required slots sit outside it/i);
      expect(text).toMatch(/customer details needed to send the quote/i);
      expect(text).toMatch(/neither is ever crowded out by it/i);
    }
  });

  it("withholds the infer licence from the required slots", () => {
    for (const text of [instructions, guestInstructions]) {
      // The brevity instruction survives...
      expect(text).toMatch(/infers the rest rather than interrogating/);
      // ...but is explicitly scoped, and explicitly denied to the required slots.
      expect(text).toMatch(/For discretionary detail/);
      expect(text).toMatch(/licence does NOT extend to the required slots/i);
      expect(text).toMatch(/never inferred, never assumed from context/i);
    }
  });

  it("requires an outstanding slot to be asked even once the budget is spent", () => {
    for (const text of [instructions, guestInstructions]) {
      expect(text).toMatch(
        /budget is spent and a required slot is still unasked, ask it anyway/i,
      );
    }
  });

  it("gates finish_job on the required slots, not on the budget alone", () => {
    const finishJob = BASE_REALTIME_TOOLS.find((tool) => tool.name === "finish_job");
    expect(finishJob).toBeDefined();

    // The tool description is the other place the model reads the rule, and it
    // used to say "or once 5 questions have been asked" with no slot condition.
    expect(finishJob?.description).toMatch(/only after the required slots/i);
    expect(finishJob?.description).not.toMatch(/once 5 questions have been asked/);
  });

  it("keeps the must-ask invariant itself intact", () => {
    // CLAUDE.md's load-bearing invariant — the V3 rewording must not have
    // displaced it.
    for (const text of [instructions, guestInstructions]) {
      expect(text).toMatch(/The pricing question in particular is not optional/);
      expect(text).toMatch(/crew, how it's priced, materials, and when they're doing it/);
    }
  });
});
