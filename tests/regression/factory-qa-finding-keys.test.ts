import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// #273: the iteration cap stopped #258 saying `incomplete-implementation` "has
// been raised 5 times without being resolved", and that "it is this one
// criterion that keeps coming back". It was not one criterion. Cycle 4 was a
// missing Edit button; cycle 5 was a money-integrity violation in a tool
// parameter. Different requirements, different files, different fixes, each
// resolved on the cycle it was raised — collapsed because they share a coarse
// category word.
//
// scripts/factory/qa-cap.sh keys on the first token after `FINDING:`, and #273
// concluded correctly that the fix belongs on the side that WRITES the key
// rather than the side that counts it: "That may need QA to emit a stable
// criterion identifier rather than a category, which is a change to what QA
// writes rather than to how the cap counts."
//
// That change has since landed in the QA prompt, unattributed, inside an
// unrelated squash. It is now what makes the cap correct — and it is prose,
// with nothing noticing if it were edited away. This pins it.
//
// It does NOT assert the cap's counting logic; factory-qa-cap.test.ts owns
// that. It asserts only that QA is still told to produce keys the cap can count.

const qa = readFileSync(".github/workflows/factory-qa.yml", "utf8");

describe("QA is told to key findings on the criterion, not the symptom", () => {
  it("says the key names the criterion rather than the symptom", () => {
    // `incomplete-implementation` is a category. Any two unrelated gaps land
    // under it, and a category count is not a criterion count.
    expect(qa).toMatch(/naming the CRITERION at issue, not[\s\S]{0,20}the symptom/);
  });

  it("explains what the cap actually counts, so the agent knows why it matters", () => {
    expect(qa).toMatch(/counts how many times the[\s\S]{0,40}SAME criterion has been raised/);
  });

  it("says to reuse a key exactly when re-raising", () => {
    // "Inventing a new name for the same objection makes a stuck argument look
    // like steady progress, and the loop never stops."
    expect(qa).toMatch(/RE-RAISING[\s\S]{0,120}Reuse its key exactly/);
  });

  it("says to give a genuinely new objection a new key", () => {
    // The other direction: reusing an old key for a different objection stops
    // the item early and wrongly, which is #273's own failure.
    expect(qa).toMatch(/genuinely NEW\?[\s\S]{0,60}Give it a new key/);
  });
});

describe("QA is handed the previous cycle's keys, so reuse is possible", () => {
  it("collects them from prior findings", () => {
    // Telling an agent to reuse a key it cannot see is not an instruction.
    expect(qa).toContain("/tmp/prior-keys.txt");
  });

  it("passes them into the review prompt", () => {
    expect(qa).toContain("Criteria you raised on the previous cycle, for reuse:");
    expect(qa).toContain("prior_keys");
  });

  it("says a key not re-raised counts as resolved", () => {
    // Without this the agent may re-raise defensively, which is the same
    // collapse #273 describes arriving by a different route.
    expect(qa).toMatch(/NOT re-raising is one you[\s\S]{0,30}consider resolved/);
  });
});
