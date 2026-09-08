import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// PFIX-5's deliverable is a GATE, and a gate that is defined, exported and
// never called is the "library function nobody calls" its own card forbids
// twice. That is exactly how it first shipped: checkNoInventedPrices was
// imported into the harness and deliberately not invoked.
//
// The frozen acceptance test meant to catch that greps harness.test.ts for the
// identifier, which an IMPORT satisfies — AGENTS.md names the failure: "indexOf
// on an identifier cannot tell an import of a name from a usage of it, and the
// import is always first." It is frozen, so it cannot be repaired, and QA has
// correctly re-raised it.
//
// This is the behavioural answer to it, and it lives outside tests/acceptance/
// so it CAN be maintained. It runs the pipeline suite for real and looks for a
// message only checkNoInventedPrices produces. Remove the call from the harness
// and this goes red; an import on its own cannot satisfy it.
//
// The two message families are deliberately distinct and must stay that way:
//
//   checkStatedPricesSurvive  'Stated £X for "item" reaches no line. Nearest is…'
//   checkNoInventedPrices     'Stated £X in transcript but no line item carries this price.'

// The repo's own binary rather than `npx`, which resolves from the working
// directory and will reach out to the registry — that cost this suite a
// 206-second timeout once already.
const VITEST = join(process.cwd(), "node_modules", ".bin", "vitest");

// Only checkNoInventedPrices emits this.
const INVENTION_GATE_MESSAGE = "in transcript but no line item carries this price";

const runPipelineSuite = (): string => {
  try {
    return execFileSync(VITEST, ["run", "--config", "vitest.pipeline.config.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // The suite is RED on scenario-1 by design — the card says so, and says the
    // only acceptable responses are to leave it red and report it or to fix the
    // pipeline honestly. So a non-zero exit is the expected path here, and its
    // output is what we assert on.
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    return `${stdout ?? ""}${stderr ?? ""}`;
  }
};

describe("the invention gate is actually invoked by the pipeline harness", () => {
  it("reports findings that only checkNoInventedPrices can produce", () => {
    const output = runPipelineSuite();

    // Guard against asserting on an empty string, which would pass vacuously if
    // the command failed to start.
    expect(output.length, "the pipeline suite produced no output at all").toBeGreaterThan(0);
    expect(output).toContain(INVENTION_GATE_MESSAGE);
  }, 120_000);
});
