import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * A `run:` block bash cannot parse is a step that reports failure and does
 * nothing about it.
 *
 * Bash reads a script incrementally, but it must parse a *compound* command in
 * full before executing any of it — so an unbalanced `if` inside a `{ … }`
 * group takes the whole group down, along with everything after it, while the
 * lines before it run normally. The step therefore looks alive in the log right
 * up to the point where it stops mattering.
 *
 * That is the worst possible shape for the step it happened to:
 * `factory-engineer.yml`'s "Mark blocked on failure", the catch-all whose only
 * job is to make sure a failure is never silent. It had six `if` openers and
 * five `fi` closers, all inside the one group that composes the comment body.
 * Run 34117621348 shows the whole effect in two consecutive log lines — it
 * identified the failing step, printed `Failing step: Push implementation`, and
 * then died on the `}`:
 *
 *     line 171: syntax error near unexpected token `}'
 *
 * Everything the step exists for is downstream of that: the comment was never
 * composed, `gh issue comment` never ran, and `gh issue edit --add-label
 * blocked` never ran. #659 lost nine minutes of Engineer rework to a failed
 * push and then sat on a bare `factory` label, which from the board reads as
 * ordinary stage cycling rather than a stop.
 *
 * The class is invisible to everything else in CI: actionlint is not run here,
 * YAML validity says nothing about the shell inside a block scalar, and a
 * handler step is only reached on a path that is by definition rare. So check
 * it directly — every `run:` block in every workflow must at least parse.
 *
 * `bash -n` is deliberately the whole bar. It reads syntax and never executes,
 * so it cannot be tripped by a missing binary, a network call or a secret, and
 * it catches the entire family: unbalanced if/fi and for/done, unterminated
 * quotes, heredocs that never close.
 */

const WORKFLOWS = resolve(__dirname, "../../.github/workflows");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Step = { workflow: string; name: string; line: number; run: string };

/**
 * GitHub substitutes `${{ … }}` before bash ever sees the script. Left in, the
 * `${` opens a parameter expansion bash rejects on its own, so every step using
 * an expression would fail for a reason that is not a defect. A bare identifier
 * is what the substituted value looks like to the parser.
 */
const neutraliseExpressions = (script: string): string =>
  script.replace(/\$\{\{[^}]*\}\}/g, "GITHUB_EXPRESSION");

/**
 * Pull the `run: |` block scalars out of a workflow.
 *
 * Done by hand rather than with a YAML library so this check carries no
 * dependency of its own — it has to keep working in exactly the situation
 * where the tree is in a state nobody expected. A block scalar is its `run:`
 * key's indentation plus everything indented further, dedented by the least
 * indentation any of its non-blank lines has, which is the rule YAML itself
 * applies.
 */
const collectSteps = (workflow: string): Step[] => {
  const lines = readFileSync(join(WORKFLOWS, workflow), "utf8").split("\n");
  const steps: Step[] = [];
  let name = "(unnamed step)";
  let nameLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const named = /^\s*- name: (.*)$/.exec(lines[i]!);
    if (named) {
      name = named[1]!.trim();
      nameLine = i + 1;
      continue;
    }

    const opener = /^(\s*)run: \|-?\s*$/.exec(lines[i]!);
    if (!opener) continue;

    const indent = opener[1]!.length;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() === "") {
        body.push("");
        continue;
      }
      if (line.length - line.trimStart().length <= indent) break;
      body.push(line);
    }

    const base = Math.min(
      ...body.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length),
    );

    steps.push({
      workflow,
      name,
      line: nameLine,
      run: body.map((l) => (l.trim() === "" ? "" : l.slice(base))).join("\n"),
    });
    i = j - 1;
  }

  return steps;
};

const allSteps = (): Step[] =>
  readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap(collectSteps);

describe("every workflow run: block is parseable by bash", () => {
  it("finds the run blocks to check", () => {
    // A guard on the guard. A change to the workflow layout that made the
    // extraction return nothing would leave this suite green while checking
    // nothing at all — the same silence it exists to catch.
    const steps = allSteps();
    expect(steps.length).toBeGreaterThan(20);
    expect(new Set(steps.map((s) => s.workflow)).size).toBeGreaterThan(5);
  });

  it("extracts a block scalar as bash would receive it, dedented", () => {
    // The dedent is the part that could silently stop working, and a heredoc is
    // where it shows: `<<'EOF'` (no dash) requires its terminator at column 0,
    // so a body left indented fails to parse for a reason that is entirely the
    // extractor's. `factory-engineer.yml`'s "Compose the task for this trigger"
    // is exactly that shape, and read undedented it reports a false failure.
    const composer = allSteps().find((s) => s.name === "Compose the task for this trigger");

    expect(composer, "the step this case is built on has been renamed").toBeDefined();
    expect(composer!.run.split("\n").some((l) => l === "TASK")).toBe(true);
  });

  it("parses every one of them", () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-shell-"));
    dirs.push(dir);

    const failures: string[] = [];

    for (const [index, step] of allSteps().entries()) {
      const path = join(dir, `step-${index}.sh`);
      writeFileSync(path, neutraliseExpressions(step.run));

      const result = spawnSync("bash", ["-n", path], {
        encoding: "utf8",
        timeout: 30_000,
      });

      if (result.status !== 0) {
        const detail = (result.stderr || "").split(path).join("<step>").trim();
        failures.push(`${step.workflow}:${step.line} — "${step.name}"\n${detail}`);
      }
    }

    expect(
      failures,
      `A step whose script does not parse fails without doing its job: bash aborts at the unparseable command and never reaches anything after it.\n\n${failures.join("\n\n")}`,
    ).toEqual([]);
  });
});
