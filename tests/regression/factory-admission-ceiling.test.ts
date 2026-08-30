import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// THE DEADLOCK. On 30 Aug the poller admitted FEE-8 (#467) and its admission
// gate correctly held it: the card says "Depends on FEE-6 and FEE-7", neither
// of which had landed. The hold applied `blocked`, which took the stopped count
// to the ceiling of 5, at which the poller admits nothing at all.
//
// So FEE-6 and FEE-7 — the only things that could release FEE-8 — could not be
// admitted, because FEE-8 was holding the door shut against its own
// dependencies. Neither gate was wrong on its own.
//
// The ceiling is a budget for HUMAN ATTENTION: its own comment says every
// stopped item "waits on the same single human". An item held for an unlanded
// ticket does not, and AGENTS.md is explicit that a dependency is "not a
// decision" and belongs back in the queue with a wake condition.
//
// Exercised by running the gate's real shell against a stub `gh`, so this tests
// the arithmetic the workflow actually performs rather than a copy of it.

const WORKFLOW = readFileSync(".github/workflows/factory-poll-notion.yml", "utf8");

/** The gate step's script, lifted verbatim from the workflow. */
const gateScript = (): string => {
  const start = WORKFLOW.indexOf("MAX_BLOCKED:");
  const runAt = WORKFLOW.indexOf("run: |", start);
  const body = WORKFLOW.slice(WORKFLOW.indexOf("\n", runAt) + 1);
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() === "") {
      lines.push("");
      continue;
    }
    if (!line.startsWith("          ")) break;
    lines.push(line.slice(10));
  }
  return lines.join("\n");
};

/**
 * Run the gate with a stubbed `gh issue list` that answers from `byLabel`,
 * keyed on the second `--label` argument.
 */
function runGate(byLabel: Record<string, number[]>, maxBlocked = 5): string {
  const dir = mkdtempSync(join(tmpdir(), "admission-"));
  const gh = join(dir, "gh");
  writeFileSync(
    gh,
    [
      "#!/usr/bin/env bash",
      // The gate calls: gh issue list --label factory --label <X> ...
      'label=""',
      "prev=''",
      'for a in "$@"; do',
      '  if [ "$prev" = "--label" ] && [ "$a" != "factory" ]; then label="$a"; fi',
      '  prev="$a"',
      "done",
      `case "$label" in`,
      ...Object.entries(byLabel).map(
        ([k, v]) => `  ${k}) echo '${JSON.stringify(v.map((n) => ({ number: n })))}' ;;`,
      ),
      "  *) echo '[]' ;;",
      "esac",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);

  const script = join(dir, "gate.sh");
  const outFile = join(dir, "out");
  writeFileSync(script, gateScript());
  writeFileSync(outFile, "");
  const stdout = execFileSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      MAX_BLOCKED: String(maxBlocked),
      GITHUB_OUTPUT: outFile,
    },
  });
  // `admit=` goes to GITHUB_OUTPUT, not stdout — the decision and the
  // human-readable log are different streams. Both are returned so a test can
  // assert on either.
  return `${stdout}\n${readFileSync(outFile, "utf8")}`;
}

const admits = (out: string): boolean => out.includes("admit=true");

describe("the admission ceiling budgets human attention", () => {
  it("admits nothing when five items genuinely wait on a person", () => {
    const out = runGate({ blocked: [1, 2, 3, 4, 5] });
    expect(admits(out)).toBe(false);
  });

  it("does not let a dependency hold close the door on its own dependency", () => {
    // The live shape: four human-blocked items plus FEE-8 held for FEE-6/FEE-7.
    const out = runGate({
      blocked: [453, 451, 444, 373, 467],
      "awaiting-dependency": [467],
    });
    expect(admits(out), "FEE-6 and FEE-7 must be admissible").toBe(true);
    expect(out).toContain("Stopped factory items: 4");
  });

  it("still stops when the human-blocked items alone reach the ceiling", () => {
    // Subtracting dependency holds must not become a way past the ceiling.
    const out = runGate({
      blocked: [1, 2, 3, 4, 5, 467],
      "awaiting-dependency": [467],
    });
    expect(admits(out)).toBe(false);
  });

  it("counts a disputed item, which does wait on a person", () => {
    const out = runGate({
      blocked: [1, 2, 3],
      "qa-disputed": [4],
      "spec-dispute": [5],
    });
    expect(admits(out)).toBe(false);
  });

  it("counts an item only once when it carries two stopped labels", () => {
    const out = runGate({ blocked: [1, 2, 3, 4, 5], "qa-disputed": [5] });
    expect(out).toContain("Stopped factory items: 5");
  });

  it("reports how many holds it discounted, so the subtraction is visible", () => {
    // A silent subtraction from a ceiling is indistinguishable from a broken
    // ceiling. The log line has to say what it did.
    const out = runGate({ blocked: [1, 467], "awaiting-dependency": [467] });
    expect(out).toMatch(/1 held for an unlanded dependency/);
  });
});
