/**
 * Refuse a migration that contains a destructive statement.
 *
 *   npx tsx scripts/ci/migration-safety.ts <file.sql> [more.sql ...]
 *
 * The rule is unchanged — migrations must be additive — but it is now applied
 * to SQL rather than to raw text.
 *
 * WHY. The check used to grep the whole file, comments included, so a migration
 * that documented its own rollback plan failed as destructive:
 *
 *     -- Down migration (for rollback):
 *     -- drop table job_costs;
 *
 * That is #244, blocked eighteen minutes after it was created for writing down
 * how to undo itself. It would recur on every migration item that documents a
 * rollback, and the LED programme is entirely migration items. A guard that
 * blocks correct work is a defect, not caution.
 *
 * WHAT IS AND IS NOT STRIPPED, and this is the load-bearing decision:
 *
 *   - `--` line comments and `/* *\/` block comments are stripped. Postgres
 *     nests block comments, so the stripper counts depth rather than scanning
 *     for the first close.
 *   - STRING LITERALS ARE NOT STRIPPED, deliberately. `EXECUTE 'drop table x'`
 *     is a destructive migration written as dynamic SQL, and stripping strings
 *     would turn this guard into one line of quoting to bypass. The cost is a
 *     false positive on a message that happens to contain the phrase — rare,
 *     loud, legible, and fixable by rewording. Weakening a money-safety guard
 *     to avoid a wording collision is the wrong side of that trade.
 *
 * The stripper preserves line numbers by replacing comment content with spaces
 * rather than deleting it, so a reported line points at the real one.
 */

import { readFileSync } from "node:fs";

/** Destructive statements, unchanged from the check this replaces. */
export const DESTRUCTIVE = [
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { label: "DROP SCHEMA", pattern: /\bDROP\s+SCHEMA\b/i },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
  { label: "DELETE FROM", pattern: /\bDELETE\s+FROM\b/i },
] as const;

/**
 * Blank out SQL comments, preserving every newline so line numbers survive.
 *
 * Handles the three things that actually appear in this repo's migrations:
 * nested block comments, dollar-quoted function bodies (`$$ … $$`, `$tag$ … $tag$`),
 * and single-quoted literals with `''` escapes. A `--` inside any of those is
 * data, not a comment, and truncating there could hide real DDL further along
 * the line.
 */
export function stripSqlComments(sql: string): string {
  const out: string[] = [];
  let i = 0;
  let blockDepth = 0;
  let inLineComment = false;
  let inSingle = false;
  let dollarTag: string | null = null;

  const push = (ch: string): void => {
    // Newlines always survive; anything inside a comment becomes a space.
    out.push(ch === "\n" ? "\n" : inLineComment || blockDepth > 0 ? " " : ch);
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      push(ch);
      i += 1;
      continue;
    }

    if (blockDepth > 0) {
      if (ch === "/" && next === "*") {
        blockDepth += 1;
        push(" ");
        push(" ");
        i += 2;
        continue;
      }
      if (ch === "*" && next === "/") {
        blockDepth -= 1;
        push(" ");
        push(" ");
        i += 2;
        continue;
      }
      push(ch);
      i += 1;
      continue;
    }

    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, i)) {
        out.push(dollarTag);
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      out.push(ch);
      i += 1;
      continue;
    }

    if (inSingle) {
      // '' is an escaped quote inside a literal, not the end of it.
      if (ch === "'" && next === "'") {
        out.push("''");
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      out.push(ch);
      i += 1;
      continue;
    }

    // Outside any literal or comment.
    if (ch === "-" && next === "-") {
      inLineComment = true;
      push(" ");
      push(" ");
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockDepth = 1;
      push(" ");
      push(" ");
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out.push(ch);
      i += 1;
      continue;
    }
    const dollar = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
    if (dollar) {
      dollarTag = dollar[0];
      out.push(dollarTag);
      i += dollarTag.length;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out.join("");
}

export interface DestructiveHit {
  label: string;
  line: number;
  text: string;
}

export function findDestructive(sql: string): DestructiveHit[] {
  const lines = stripSqlComments(sql).split("\n");
  const hits: DestructiveHit[] = [];
  for (const [index, line] of lines.entries()) {
    for (const { label, pattern } of DESTRUCTIVE) {
      if (pattern.test(line)) {
        hits.push({ label, line: index + 1, text: line.trim().slice(0, 200) });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------- runtime

function main(): void {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    console.log("No migrations to check.");
    return;
  }

  let failed = false;
  for (const file of files) {
    let sql: string;
    try {
      sql = readFileSync(file, "utf8");
    } catch {
      // A migration named in the diff but absent from the tree is a deletion,
      // which the diff itself already surfaces. Nothing to scan.
      continue;
    }
    const hits = findDestructive(sql);
    if (hits.length === 0) {
      console.log(`ok: ${file}`);
      continue;
    }
    failed = true;
    for (const hit of hits) {
      console.log(
        `::error file=${file},line=${hit.line}::${hit.label} outside a comment. Migrations must be additive. — ${hit.text}`,
      );
    }
  }

  if (failed) {
    console.log(
      "\nComments are stripped before this scan, so a documented rollback plan does not fail it. String literals are NOT stripped: `EXECUTE 'drop table x'` is a destructive migration written as dynamic SQL, and exempting strings would make this guard one quote away from bypassable.",
    );
    process.exit(1);
  }
  console.log("::notice::Migrations present — this PR requires individual human review.");
}

if (process.argv[1]?.endsWith("migration-safety.ts")) main();
