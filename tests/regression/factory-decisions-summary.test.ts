import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Under the self-resolution protocol an agent takes a judgement call instead
 * of blocking on it. That is the cheaper policy only while the decisions stay
 * visible: reversing from a digest costs a revert, and finding out six weeks
 * later that four tickets inherited a pattern nobody saw costs four. The queue
 * stopped asking, so the digest has to tell.
 *
 * RUNNABLE: npx tsx scripts/factory/summarise-decisions.ts --days 1
 */

const REPO = resolve(__dirname, "../..");
const SCRIPT = "scripts/factory/summarise-decisions.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const recordFile = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "decisions-"));
  dirs.push(dir);
  const file = join(dir, "motko.md");
  writeFileSync(file, body);
  return file;
};

// Invoked end to end, as AGENTS.md requires of anything runnable — importing
// the function behind a command is satisfied by a library that has no entry
// point, which is how two money backfills shipped unrunnable.
const run = (file: string, days: string): string =>
  execFileSync("npx", ["tsx", SCRIPT, "--file", file, "--days", days], {
    cwd: REPO,
    encoding: "utf8",
  });

const TODAY = new Date().toISOString().slice(0, 10);

const ENTRY = (over: Partial<Record<string, string>> = {}) =>
  [
    `## ${over.date ?? TODAY} — ${over.question ?? "Which sort order does the list use?"}`,
    `Decision: ${over.decision ?? "Money-urgency tiers, oldest first within each tier,"}`,
    "and a job-id tie-break so the order cannot shuffle between renders.",
    `Rationale: ${over.rationale ?? "Outstanding money is what a contractor needs first."}`,
    `Ticket: ${over.ticket ?? "#300"}`,
    `Reversible: ${over.reversible ?? "yes"}`,
    `Precedent: ${over.precedent ?? "no"}`,
    "",
  ].join("\n");

describe("what the digest shows", () => {
  it("lists a decision an agent took today", () => {
    const out = run(recordFile(ENTRY()), "1");
    expect(out).toContain("Which sort order does the list use?");
    expect(out).toContain("Money-urgency tiers");
  });

  // The obvious regex for this truncates every value at its first line,
  // because `$` under the `m` flag means end of line. The record asks for two
  // lines of rationale, so that silently drops half of every entry.
  it("keeps a value that wraps onto a second line", () => {
    const out = run(recordFile(ENTRY()), "1");
    expect(out).toContain("job-id tie-break");
  });

  it("leads with the ones that set a precedent", () => {
    const record = recordFile(
      ENTRY({ question: "An ordinary call", precedent: "no" }) +
        ENTRY({ question: "A pattern later tickets copy", precedent: "yes" }),
    );
    const out = run(record, "1");
    expect(out.indexOf("A pattern later tickets copy")).toBeLessThan(
      out.indexOf("An ordinary call"),
    );
    expect(out).toContain("sets a precedent");
    expect(out, "the count is what makes it scannable").toMatch(/\*\*1 sets a precedent\*\*/);
  });

  it("flags a decision a revert does not undo", () => {
    const out = run(recordFile(ENTRY({ reversible: "no" })), "1");
    expect(out).toContain("not reversible");
  });

  it("ignores the undated standing decisions", () => {
    const record = recordFile(
      "## Prior — Does the contract print bank details?\nDecision: Only when the rail is unavailable.\nReversible: yes\n\n" +
        ENTRY(),
    );
    const out = run(record, "1");
    expect(out).toContain("Which sort order");
    expect(out, "seeded entries describe what was already true").not.toContain(
      "Does the contract print bank details",
    );
  });

  it("drops a decision older than the window", () => {
    const out = run(recordFile(ENTRY({ date: "2020-01-01" })), "1");
    expect(out).toContain("none in the last day");
  });

  // A quiet section is not the same as good news, and saying so is the point:
  // under this protocol most judgement calls should be taken rather than asked.
  it("says something on a quiet day rather than nothing", () => {
    const out = run(recordFile("# empty\n"), "1");
    expect(out.trim()).not.toBe("");
    expect(out).toMatch(/still blocking on things they should decide/i);
  });

  it("survives a record that is not there at all", () => {
    const out = execFileSync("npx", ["tsx", SCRIPT, "--file", "/nope/motko.md"], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(out).toMatch(/could not be read/i);
    expect(out, "must not read as 'no decisions'").toMatch(/factory fault/i);
  });
});

describe("the digest calls it", () => {
  const digest = readFileSync(
    resolve(REPO, ".github/workflows/factory-decisions-digest.yml"),
    "utf8",
  );

  it("runs the composer", () => {
    expect(digest).toContain("summarise-decisions.ts");
  });

  // The spec disputes and the stalled sweep are the parts someone is waiting
  // on; a decisions section that dies must not take them with it.
  it("does not let a failure here kill the rest of the digest", () => {
    const call = digest.slice(digest.indexOf("summarise-decisions.ts"));
    expect(call.slice(0, 300)).toContain("||");
  });
});
