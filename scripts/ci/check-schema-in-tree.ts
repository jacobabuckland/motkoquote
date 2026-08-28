/**
 * CLI for scripts/ci/schema-in-tree.ts. See that file for what this check does
 * and — more importantly — what it cannot see.
 *
 * Findings on lines this PR WROTE are errors. Findings anywhere else — including
 * elsewhere in a file this PR touched — are warnings, following the same split
 * scripts/ci/schema-probe.ts already uses.
 * The reason is not squeamishness: this check found twelve pre-existing drifts
 * on main the first time it ran, three of them in code that redirects or throws
 * on the rejected query and one in a fee-recovery path. Blocking every PR until
 * all twelve are fixed would mean the check never lands, and a check that never
 * lands catches nothing. New drift is refused from the moment this merges; the
 * backlog is visible on every run until it is worked off.
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { findDrift, schemaFromMigrations, type Finding } from "./schema-in-tree";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * The line numbers a unified diff ADDS, per file.
 *
 * Expects `--unified=0`, whose hunk headers give the added-line ranges with no
 * surrounding context to subtract. `@@ -12 +12 @@` (no count) is one line;
 * `@@ -0,0 +40,3 @@` is three starting at 40; a count of 0 is a pure deletion
 * and adds nothing.
 */
export const parseAddedLines = (diff: string): Map<string, Set<number>> => {
  const added = new Map<string, Set<number>>();
  let current = "";

  for (const line of diff.split("\n")) {
    const fileMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (fileMatch?.[1]) {
      current = fileMatch[1];
      if (!added.has(current)) added.set(current, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk?.[1] && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const set = added.get(current)!;
      for (let i = 0; i < count; i += 1) set.add(start + i);
    }
  }

  return added;
};

/**
 * Did this PR write the select that names this column?
 *
 * The whole span, not just the line the select opens on. A select string
 * spread over several lines reports every column it names at its opening
 * line, so a column added on line four of one would otherwise read as
 * inherited drift — and "add a column to an existing query" is exactly the
 * edit this check exists to catch.
 */
export const wasWritten = (
  addedLines: Map<string, Set<number>>,
  finding: Finding,
): boolean => {
  const added = addedLines.get(finding.file);
  if (!added) return false;
  for (let line = finding.line; line <= finding.endLine; line += 1) {
    if (added.has(line)) return true;
  }
  return false;
};

const walk = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
};

const main = (): void => {
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      path: join(MIGRATIONS_DIR, name),
      sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8"),
    }));

  const { tables, unmodelled } = schemaFromMigrations(migrations);

  // A rename or a drop means the column set this built is wrong, and a wrong
  // column set produces confident nonsense in both directions. Refuse rather
  // than report against it.
  if (unmodelled.length > 0) {
    console.log(
      "::error title=Migration shape this check does not model::" +
        `These migrations rename or drop a column, which schema-in-tree.ts does not track: ${unmodelled.join(", ")}. ` +
        "Teach the parser that shape before merging, or the column set it builds is wrong.",
    );
    process.exit(1);
  }

  // Which LINES this PR wrote, per file — not merely which files it touched.
  //
  // This used to filter by file, but touching a file is not introducing a
  // finding in it. #403 was blocked by
  // `jobs.description` at query-actions.ts:199 — a select that has been on main
  // since long before that item existed, and one of the twelve pre-existing
  // drifts the #409 decision in areas/motko.md enumerates. The Engineer edited
  // that file to change getWhatsLeft, seventy lines away, and inherited the
  // error.
  //
  // That decision's own precedent line says the check blocks "on what a PR
  // introduces and warning on what it inherits". Blocking on proximity is
  // neither, and it is worse than an ordinary false positive: each of the
  // twelve known drifts becomes a landmine under whichever file carries it, so
  // the items most likely to trip it are the ones touching the code that most
  // needs changing.
  //
  // Parsed from unified diff hunk headers with --unified=0, which give the
  // added-line ranges directly. A finding fails the build only when its line is
  // one this PR actually wrote.
  const base = process.env.GITHUB_BASE_REF;
  let addedLines = new Map<string, Set<number>>();
  if (base) {
    try {
      addedLines = parseAddedLines(
        execSync(`git diff --unified=0 origin/${base}...HEAD -- src/`, { encoding: "utf8" }),
      );
    } catch {
      // No merge base to diff against. Everything is reported as a warning,
      // which is the safe direction: this must not fail a PR because git did.
      addedLines = new Map();
      console.log(
        "::warning title=schema-in-tree could not read the diff::Reporting every finding as a warning rather than failing on one this PR may not have introduced.",
      );
    }
  }

  const findings: Finding[] = walk("src")
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .flatMap((file) => findDrift(file, readFileSync(file, "utf8"), tables));

  const introduced = findings.filter((f) => wasWritten(addedLines, f));
  const existing = findings.filter((f) => !wasWritten(addedLines, f));

  const describe = (f: Finding): string =>
    `${f.table}.${f.column} — no migration in this tree creates it`;

  for (const f of existing) {
    console.log(
      `::warning file=${f.file},line=${f.line},title=Column no migration creates::${describe(f)}`,
    );
  }

  for (const f of introduced) {
    console.log(
      `::error file=${f.file},line=${f.line},title=Column no migration creates::${describe(f)}. ` +
        "PostgREST rejects this select at runtime. If the column is new, its migration belongs in this tree — and on production — before the code that names it.",
    );
  }

  if (introduced.length > 0) {
    console.log(
      `\n${introduced.length} column reference(s) written by this PR name a column no migration creates.`,
    );
    process.exit(1);
  }

  console.log(
    existing.length === 0
      ? "Every column named by a select is created by a migration in this tree."
      : `No new drift. ${existing.length} pre-existing finding(s) reported above as warnings.`,
  );
  console.log(
    "This check reads the tree only. It cannot tell you whether these migrations have been APPLIED to production — that is schema-drift-probe's job, and it has never run.",
  );
};

if (require.main === module) {
  main();
}
