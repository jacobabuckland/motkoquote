/**
 * CLI for scripts/ci/schema-in-tree.ts. See that file for what this check does
 * and — more importantly — what it cannot see.
 *
 * Findings in files this PR CHANGED are errors. Findings anywhere else are
 * warnings, following the same split scripts/ci/schema-probe.ts already uses.
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

  const base = process.env.GITHUB_BASE_REF;
  let changed = new Set<string>();
  if (base) {
    try {
      changed = new Set(
        execSync(`git diff --name-only origin/${base}...HEAD -- src/`, {
          encoding: "utf8",
        })
          .split("\n")
          .filter(Boolean),
      );
    } catch {
      // No merge base to diff against. Everything is reported as a warning,
      // which is the safe direction: this must not fail a PR because git did.
      console.log(
        "::warning title=schema-in-tree could not read the diff::Reporting every finding as a warning rather than failing on one this PR may not have introduced.",
      );
    }
  }

  const findings: Finding[] = walk("src")
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .flatMap((file) => findDrift(file, readFileSync(file, "utf8"), tables));

  const introduced = findings.filter((f) => changed.has(f.file));
  const existing = findings.filter((f) => !changed.has(f.file));

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
      `\n${introduced.length} column reference(s) in files this PR changed name a column no migration creates.`,
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
