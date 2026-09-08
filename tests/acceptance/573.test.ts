import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("HARN-4: Nightly pipeline suite reporting", () => {
  it("workflow file exists", () => {
    const workflowPath = resolve(__dirname, "../../.github/workflows/pipeline-nightly.yml");
    expect(existsSync(workflowPath)).toBe(true);
  });

  it("reporting script exists and exports parseVitestOutput", async () => {
    const { parseVitestOutput } = await import("../../scripts/ci/report-pipeline-findings");
    expect(typeof parseVitestOutput).toBe("function");
  });

  it("parseVitestOutput detects prompt hash mismatch", async () => {
    const { parseVitestOutput } = await import("../../scripts/ci/report-pipeline-findings");

    const output = `
 FAIL  tests/pipeline/harness.test.ts > Pipeline replay harness > Scenario 1: Bathroom refit > narrative stage generates SoW overview
Error: Prompt hash mismatch for scenario-1 at stage narrative.
Expected: c8bf377faa647e0a
Got: 87db462b6bca5c10
The prompt has changed since this recording was made. Re-record with RECORD_PIPELINE=1 or revert the prompt change.
    `;

    const result = parseVitestOutput(output);

    expect(result.hasPromptHashMismatch).toBe(true);
    expect(result.hasContentFindings).toBe(false);
  });

  it("parseVitestOutput detects content findings", async () => {
    const { parseVitestOutput } = await import("../../scripts/ci/report-pipeline-findings");

    const output = `
 FAIL  tests/pipeline/harness.test.ts > Pipeline replay harness > Scenario 1: Bathroom refit > compile stage produces expected line items
AssertionError: The compiled quote does not match what the transcript says it should be:
  [scenario-1 · compile] Expected a line "Bathroom refit labour — owner and apprentice, 5 days" and the quote has none.
  [scenario-1 · compile] Stated £1400.00 for "tiling labour" reaches no line.
    `;

    const result = parseVitestOutput(output);

    expect(result.hasContentFindings).toBe(true);
    expect(result.hasPromptHashMismatch).toBe(false);
  });

  it("parseVitestOutput detects both types of failure", async () => {
    const { parseVitestOutput } = await import("../../scripts/ci/report-pipeline-findings");

    const output = `
 FAIL  tests/pipeline/harness.test.ts > narrative stage generates SoW overview
Error: Prompt hash mismatch for scenario-1 at stage narrative.

 FAIL  tests/pipeline/harness.test.ts > compile stage produces expected line items
AssertionError: The compiled quote does not match what the transcript says it should be:
  [scenario-1 · compile] Stated £1400.00 for "tiling labour" reaches no line.
    `;

    const result = parseVitestOutput(output);

    expect(result.hasPromptHashMismatch).toBe(true);
    expect(result.hasContentFindings).toBe(true);
  });

  it("parseVitestOutput detects no failures on passing suite", async () => {
    const { parseVitestOutput } = await import("../../scripts/ci/report-pipeline-findings");

    const output = `
 RUN  v4.1.10 /home/runner/work/motkoquote/motkoquote

 ✓ tests/pipeline/harness.test.ts (9 tests) 1250ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
    `;

    const result = parseVitestOutput(output);

    expect(result.hasPromptHashMismatch).toBe(false);
    expect(result.hasContentFindings).toBe(false);
  });

  it("parseVitestOutput extracts failure details", async () => {
    const { parseVitestOutput } = await import("../../scripts/ci/report-pipeline-findings");

    const output = `
 FAIL  tests/pipeline/harness.test.ts > Pipeline replay harness > Scenario 1: Bathroom refit > compile stage produces expected line items
AssertionError: The compiled quote does not match what the transcript says it should be:
  [scenario-1 · compile] Expected a line "Bathroom refit labour — owner and apprentice, 5 days" and the quote has none.
  [scenario-1 · compile] Stated £1400.00 for "tiling labour" reaches no line. Nearest is "Bathroom suite" at £0.00.
    `;

    const result = parseVitestOutput(output);

    expect(result.details).toBeDefined();
    expect(result.details.length).toBeGreaterThan(0);
    expect(result.details.some((d: string) => d.includes("£1400.00"))).toBe(true);
  });

  it("parseVitestOutput produces a summary message for prompt hash mismatch", async () => {
    const { parseVitestOutput } = await import("../../scripts/ci/report-pipeline-findings");

    const output = `
Error: Prompt hash mismatch for scenario-1 at stage narrative.
Expected: c8bf377faa647e0a
Got: 87db462b6bca5c10
    `;

    const result = parseVitestOutput(output);

    expect(result.summary).toBeDefined();
    expect(result.summary).toContain("stale recording");
  });

  it("parseVitestOutput produces a summary message for content findings", async () => {
    const { parseVitestOutput } = await import("../../scripts/ci/report-pipeline-findings");

    const output = `
AssertionError: The compiled quote does not match what the transcript says it should be:
  [scenario-1 · compile] Stated £1400.00 for "tiling labour" reaches no line.
    `;

    const result = parseVitestOutput(output);

    expect(result.summary).toBeDefined();
    expect(result.summary).toContain("content");
  });

  it("parseVitestOutput handles empty output", async () => {
    const { parseVitestOutput } = await import("../../scripts/ci/report-pipeline-findings");

    const result = parseVitestOutput("");

    expect(result.hasPromptHashMismatch).toBe(false);
    expect(result.hasContentFindings).toBe(false);
    expect(result.details).toEqual([]);
  });

  it("parseVitestOutput identifies scenario and stage from failures", async () => {
    const { parseVitestOutput } = await import("../../scripts/ci/report-pipeline-findings");

    const output = `
Error: Prompt hash mismatch for scenario-1 at stage narrative.
    `;

    const result = parseVitestOutput(output);

    expect(result.failedScenarios).toBeDefined();
    expect(result.failedScenarios).toContain("scenario-1");
  });
});
