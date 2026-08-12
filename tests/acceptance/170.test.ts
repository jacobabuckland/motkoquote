import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

describe("Issue #170: PM prompt requires anchored criteria", () => {
  it("includes the anchoring requirement in the PM prompt", async () => {
    const pmWorkflow = await readFile(".github/workflows/factory-pm.yml", "utf-8");

    // The PM prompt must require each acceptance criterion to carry a reference to its test assertion
    expect(pmWorkflow).toMatch(/each\s+(?:acceptance\s+)?criterion.*anchor/i);
    expect(pmWorkflow).toMatch(/test\s+(?:file|assertion)/i);
  });

  it("documents the anchor format with examples in the prompt", async () => {
    const pmWorkflow = await readFile(".github/workflows/factory-pm.yml", "utf-8");

    // The prompt should show the canonical anchor format
    // Looking for patterns like: tests/acceptance/N.test.ts: "describe > it"
    expect(pmWorkflow).toMatch(/tests\/acceptance.*describe.*it/);
  });
});

describe("Issue #170: Validation script exists and works", () => {
  it("creates the validation script at scripts/factory/validate-anchored-criteria.sh", async () => {
    const mod = await import("node:fs/promises");
    const stats = await mod.stat("scripts/factory/validate-anchored-criteria.sh");
    expect(stats.isFile()).toBe(true);
  });

  it("is executable", async () => {
    const mod = await import("node:fs/promises");
    const stats = await mod.stat("scripts/factory/validate-anchored-criteria.sh");
    // Check if executable bit is set (mode & 0o111)
    expect(stats.mode & 0o111).toBeGreaterThan(0);
  });

  it("identifies unanchored criteria in a spec", async () => {
    // Create a test spec with an unanchored criterion
    const testSpec = `# Test spec

## Acceptance criteria

- The PM prompt requires anchored criteria → tests/acceptance/170.test.ts: "PM prompt requires anchored criteria > includes the anchoring requirement"
- This criterion is NOT anchored and should be caught
- Another anchored one → tests/acceptance/170.test.ts:123
`;

    const testFile = "/tmp/test-spec-170.md";
    await import("node:fs/promises").then((mod) => mod.writeFile(testFile, testSpec));

    // The script should exit non-zero and report the unanchored criterion
    await expect(
      execAsync("scripts/factory/validate-anchored-criteria.sh /tmp/test-spec-170.md tests/acceptance/170.test.ts"),
    ).rejects.toThrow();
  });

  it("passes when all criteria are anchored", async () => {
    const testSpec = `# Test spec

## Acceptance criteria

- First criterion → tests/acceptance/170.test.ts: "Group > Test name"
- Second criterion → tests/acceptance/170.test.ts:42
`;

    const testFile = "/tmp/test-spec-170-valid.md";
    await import("node:fs/promises").then((mod) => mod.writeFile(testFile, testSpec));

    // Should exit 0 when all criteria have anchors
    const { stdout } = await execAsync(
      "scripts/factory/validate-anchored-criteria.sh /tmp/test-spec-170-valid.md tests/acceptance/170.test.ts",
    );
    expect(stdout).toBeDefined();
  });

  it("treats criteria with non-existent test references as unanchored", async () => {
    const testSpec = `# Test spec

## Acceptance criteria

- This points to a test that does not exist → tests/acceptance/999.test.ts: "Nonexistent > Test"
`;

    const testFile = "/tmp/test-spec-170-fake.md";
    await import("node:fs/promises").then((mod) => mod.writeFile(testFile, testSpec));

    // Should fail because the referenced test file doesn't exist
    await expect(
      execAsync("scripts/factory/validate-anchored-criteria.sh /tmp/test-spec-170-fake.md tests/acceptance/999.test.ts"),
    ).rejects.toThrow();
  });
});

describe("Issue #170: PM workflow integrates the validation", () => {
  it("adds a validation step after artefact verification", async () => {
    const pmWorkflow = await readFile(".github/workflows/factory-pm.yml", "utf-8");

    // Should have a step that validates anchored criteria
    expect(pmWorkflow).toMatch(/validate.*anchor/i);
    expect(pmWorkflow).toMatch(/scripts\/factory\/validate-anchored-criteria\.sh/);
  });

  it("blocks the item when criteria are unanchored", async () => {
    const pmWorkflow = await readFile(".github/workflows/factory-pm.yml", "utf-8");

    // The validation step should block the item and add the blocked label
    expect(pmWorkflow).toMatch(/--add-label blocked/);
    expect(pmWorkflow).toMatch(/unanchored/i);
  });

  it("names which criteria are unanchored in the block message", async () => {
    const pmWorkflow = await readFile(".github/workflows/factory-pm.yml", "utf-8");

    // The block message should identify specific unanchored criteria
    // This is typically done by the validation script outputting them
    expect(pmWorkflow).toMatch(/which.*criteria|criteria.*missing/i);
  });
});

describe("Issue #170: QA prompt respects anchored assertions", () => {
  it("states that passing anchored assertions satisfy criteria", async () => {
    const qaWorkflow = await readFile(".github/workflows/factory-qa.yml", "utf-8");

    // QA prompt must state that anchored assertions decide criterion satisfaction
    expect(qaWorkflow).toMatch(/anchor.*(?:assertion|test)/i);
    expect(qaWorkflow).toMatch(/passes.*satisfied|satisfied.*passes/i);
  });

  it("forbids re-raising criteria on prose grounds when assertion passes", async () => {
    const qaWorkflow = await readFile(".github/workflows/factory-qa.yml", "utf-8");

    // Must explicitly state criteria cannot be re-raised on prose grounds
    expect(qaWorkflow).toMatch(/may not.*re-raise|cannot.*re-raise|not.*re-raised/i);
    expect(qaWorkflow).toMatch(/prose/i);
  });

  it("preserves the escape hatch for tests that are plainly wrong", async () => {
    const qaWorkflow = await readFile(".github/workflows/factory-qa.yml", "utf-8");

    // Should allow raising findings against the test itself
    expect(qaWorkflow).toMatch(/finding.*(?:against|about).*test|test.*(?:is|plainly)\s+wrong/i);
  });

  it("preserves QA's ability to raise non-criterion findings", async () => {
    const qaWorkflow = await readFile(".github/workflows/factory-qa.yml", "utf-8");

    // Should explicitly state non-criterion findings are unaffected
    expect(qaWorkflow).toMatch(/(?:files|scope|error handling|migration|secrets)/i);
    expect(qaWorkflow).toMatch(/non-criterion|not.*criteria|beyond.*criteria/i);
  });
});

describe("Issue #170: Worked example from #93", () => {
  it("includes the #93 timeout criterion with an anchor", async () => {
    const spec = await readFile("docs/specs/170.md", "utf-8");

    // Should reference #93
    expect(spec).toMatch(/#93/);

    // Should show the old unanchored criterion
    expect(spec).toMatch(/chargeMandate.*withTimeout/i);

    // Should show the new anchored version
    expect(spec).toMatch(/tests\/acceptance\/93\.test\.ts.*timeout/i);
  });

  it("explains why the anchor makes it decidable", async () => {
    const spec = await readFile("docs/specs/170.md", "utf-8");

    // Should explain that the anchor removes ambiguity
    expect(spec).toMatch(/decidable|ambiguity.*(?:removed|gone)/i);
    expect(spec).toMatch(/assertion.*(?:decides|passes)/i);
  });

  it("shows the three-cycle disagreement in the old version", async () => {
    const spec = await readFile("docs/specs/170.md", "utf-8");

    // Should document what the three cycles disagreed on
    expect(spec).toMatch(/cycle\s+1|cycle\s+2|cycle\s+3/i);
    expect(spec).toMatch(/disagreed|disagreement/i);
  });
});

describe("Issue #170: AMBIGUOUS route for unanchorable criteria", () => {
  it("documents the AMBIGUOUS route in the PM prompt", async () => {
    const pmWorkflow = await readFile(".github/workflows/factory-pm.yml", "utf-8");

    // The existing AMBIGUOUS path should still be documented
    expect(pmWorkflow).toMatch(/AMBIGUOUS:/);
    expect(pmWorkflow).toMatch(/cannot.*(?:be\s+)?(?:expressed|anchored)/i);
  });

  it("allows AMBIGUOUS specs to bypass anchor validation", async () => {
    const pmWorkflow = await readFile(".github/workflows/factory-pm.yml", "utf-8");

    // Validation should be skipped for ambiguous specs
    // Looking for a conditional that checks the outcome
    expect(pmWorkflow).toMatch(/if:.*outcome.*(?:proceed|!= 'ambiguous')/);
  });
});

describe("Issue #170: Out of scope checks", () => {
  it("does not change the QA iteration cap", async () => {
    const qaWorkflow = await readFile(".github/workflows/factory-qa.yml", "utf-8");

    // The cap should still be 3
    expect(qaWorkflow).toMatch(/cycles\s*>=\s*3/);
  });

  it("does not change the label state machine", async () => {
    const pmWorkflow = await readFile(".github/workflows/factory-pm.yml", "utf-8");

    // Should still use the existing labels
    expect(pmWorkflow).toMatch(/spec-derived/);
    expect(pmWorkflow).toMatch(/needs-spec/);
  });

  it("does not change acceptance test immutability rules", async () => {
    const pmWorkflow = await readFile(".github/workflows/factory-pm.yml", "utf-8");

    // Should still mention that tests are frozen after the PM commit
    expect(pmWorkflow).toMatch(/frozen|immutab/i);
    expect(pmWorkflow).toMatch(/Engineer.*(?:forbidden|may not)/i);
  });
});
