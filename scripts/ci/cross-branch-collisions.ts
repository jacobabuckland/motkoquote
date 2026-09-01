/**
 * Detect collisions between this pull request and the other open factory
 * branches, before either side merges.
 *
 *   npx tsx scripts/ci/cross-branch-collisions.ts [--base main] [--head factory/188]
 *
 * WHY. Every one of the four collisions in the 16-17 August field review was
 * mechanically detectable from the branches themselves, and one of them reached
 * production. Two branches claimed the same migration version. Two shipped the
 * same component under incompatible APIs, both frozen, so neither contract could
 * give way. Three separate items edited the same shared test helper. Nothing
 * looked at more than one branch at a time, so each was discovered by whoever
 * merged second — which is the most expensive moment to find out.
 *
 * A factory branch is cut from main and reviewed against main, so it is
 * structurally blind to every sibling in flight. That blindness is the defect;
 * this is the thing that can see across.
 *
 * The detection logic below is pure — it takes file lists and returns findings —
 * so it is exercised against real branch shapes in tests rather than only in
 * anger on a PR that is already too late.
 */

/** Files that may only be written once, by the PM, in a branch's first commit. */
export const FROZEN_PREFIXES = ["tests/acceptance/", "docs/specs/"] as const;

/**
 * Test infrastructure every suite in the repo loads. An edit here has a blast
 * radius of the whole test run, so two branches editing it are colliding
 * whether or not the lines overlap — #140's `tests/setup.ts` change injects a
 * stylesheet and proxies getComputedStyle for every DOM test there is.
 */
export const SHARED_TEST_PREFIXES = ["tests/helpers/", "tests/setup.ts"] as const;

export const MIGRATION_PREFIX = "supabase/migrations/";

/**
 * Branch prefixes this check never compares against.
 *
 * `archive/` is a convention meaning "parked, will not merge" — ten such
 * branches exist and none is a candidate for landing, so a collision with one
 * is not a collision with anything.
 */
export const IGNORED_BRANCH_PREFIXES = ["archive/"] as const;

/**
 * Branches with no merge base against main, which cannot be diffed meaningfully.
 *
 * `factory-state` is the supervisor's ORPHAN state branch: it shares no history
 * with main by design, so a three-dot diff against main reports every file on
 * it as changed. Left in, it would collide with everything, every run.
 */
export const IGNORED_BRANCHES = ["factory-state"] as const;

/**
 * Which sibling branches a run compares itself against.
 *
 * This used to be `origin/factory/*`, and that was the hole. The check has a
 * `migration-version` rule written precisely because "two branches claimed the
 * same migration version" reached production once — and on 31 Aug it happened
 * again, between `factory/475` and `claude/public-surface-migrations`, both
 * claiming 00000000000054. Both runs passed. Neither could see the other,
 * because only one of them was named `factory/*`.
 *
 * Work reaches main from more than one kind of branch: factory items, and
 * branches an agent or a human cuts by hand. The guard has to look at whatever
 * can land, not at whatever follows one naming convention — a check that sees
 * part of the problem reports success on the rest.
 *
 * Unmerged still stands in for "open": it needs no API call and no token, and a
 * branch already on main cannot collide by definition. That proxy is looser
 * over a wider set — some of these are abandoned rather than open — but the
 * cost of comparing against a dead branch is one noisy line, and the cost of
 * missing a live one is a duplicate migration version on production.
 */
export function selectSiblings(refs: string[], headRef: string): string[] {
  return refs
    .map((l) => l.trim())
    .filter(Boolean)
    // `git branch -r` lists the symbolic HEAD as "origin/HEAD -> origin/main".
    .filter((ref) => !ref.includes("->"))
    .filter((ref) => ref !== `origin/${headRef}`)
    .filter((ref) => {
      const name = ref.replace(/^origin\//, "");
      if ((IGNORED_BRANCHES as readonly string[]).includes(name)) return false;
      return !IGNORED_BRANCH_PREFIXES.some((prefix) => name.startsWith(prefix));
    });
}

export type CollisionKind =
  | "migration-version"
  | "migration-below-watermark"
  | "frozen-file"
  | "shared-test-helper"
  | "deleted-module-still-imported";

export interface Collision {
  kind: CollisionKind;
  /** The branch this PR collides WITH, or "main". */
  other: string;
  path: string;
  detail: string;
}

export interface BranchDiff {
  branch: string;
  /** Every path in the branch's three-dot diff against main. */
  changed: string[];
  /** Paths the branch deletes. */
  deleted: string[];
  /**
   * False when the branch could not be diffed against the base at all — no
   * merge base, unrelated histories, a ref that vanished mid-run.
   *
   * This exists because the first version of this scanner swallowed that case
   * and carried on with an empty file list, which reads downstream as "this
   * branch collides with nothing". It found `factory/132` that way: it has a
   * different root commit from main, so it has no merge base, can never merge,
   * and was silently excluded from every comparison. A branch that cannot be
   * read is not a branch with no collisions, and a check that quietly narrows
   * its own coverage is worse than one that fails.
   */
  readable: boolean;
}

/**
 * The version a migration filename claims, which is the part the database
 * orders and deduplicates by. Two branches may add different migrations; they
 * may not both claim the same version, because whichever merges second is
 * either rejected or silently skipped depending on the tool.
 */
export function migrationVersion(path: string): string | null {
  if (!path.startsWith(MIGRATION_PREFIX)) return null;
  const file = path.slice(MIGRATION_PREFIX.length);
  const match = /^(\d{8,})[_.]/.exec(file);
  return match ? match[1] : null;
}

const startsWithAny = (path: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));

export function detectMigrationCollisions(
  self: BranchDiff,
  others: BranchDiff[],
  mainMigrations: string[],
): Collision[] {
  const found: Collision[] = [];
  const mine = new Map<string, string>();
  for (const path of self.changed) {
    const version = migrationVersion(path);
    if (version !== null) mine.set(version, path);
  }
  if (mine.size === 0) return found;

  for (const path of mainMigrations) {
    const version = migrationVersion(path);
    if (version === null || !mine.has(version)) continue;
    // Re-adding the identical path is this branch carrying a migration that has
    // since landed on main, which the merge resolves. A DIFFERENT file claiming
    // a version main already used is the collision.
    if (path === mine.get(version)) continue;
    found.push({
      kind: "migration-version",
      other: "main",
      path: mine.get(version)!,
      detail: `version \`${version}\` is already claimed on main by \`${path}\``,
    });
  }

  for (const other of others) {
    for (const path of other.changed) {
      const version = migrationVersion(path);
      if (version === null || !mine.has(version)) continue;
      if (path === mine.get(version)) continue;
      found.push({
        kind: "migration-version",
        other: other.branch,
        path: mine.get(version)!,
        detail: `version \`${version}\` is also claimed by \`${other.branch}\` in \`${path}\``,
      });
    }
  }
  return found;
}

/** Numeric-string comparison: shorter is smaller, then lexicographic. */
export function compareVersions(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function highestMigrationVersion(paths: string[]): string | null {
  let highest: string | null = null;
  for (const path of paths) {
    const version = migrationVersion(path);
    if (version === null) continue;
    if (highest === null || compareVersions(version, highest) > 0) highest = version;
  }
  return highest;
}

/**
 * A migration numbered BELOW the highest version already applied on main.
 *
 * Supabase migrations are applied manually and ordered by version, so one that
 * arrives numbered lower than the high-water mark is out of order by the time it
 * lands. `supabase db push` may skip it, or require forcing — and the failure
 * that matters is the quiet one: recorded as applied while its DDL never ran,
 * which CLAUDE.md calls a ghost apply and warns about explicitly.
 *
 * This is not the same defect as two branches claiming one version, and the
 * same-version check does not catch it. It came from three live instances at
 * once: main had applied 32-35, 37 and 40, while three unmerged branches sat on
 * 36, 38 and 39. Each would have been out of order the moment it merged.
 *
 * A branch is only ever flagged for a migration it INTRODUCES; carrying an older
 * one that is already on main is what being behind looks like, not a defect.
 */
export function detectMigrationWatermark(
  self: BranchDiff,
  mainMigrations: string[],
): Collision[] {
  const watermark = highestMigrationVersion(mainMigrations);
  if (watermark === null) return [];

  const onMain = new Set(mainMigrations);
  const found: Collision[] = [];
  for (const path of self.changed) {
    const version = migrationVersion(path);
    if (version === null || onMain.has(path)) continue;
    if (compareVersions(version, watermark) > 0) continue;
    found.push({
      kind: "migration-below-watermark",
      other: "main",
      path,
      detail:
        `claims version \`${version}\`, but main has already applied \`${watermark}\`. ` +
        `Renumber it above \`${watermark}\` before merging — an out-of-order migration can be ` +
        `recorded as applied while its DDL never runs, and the ledger will not show it.`,
    });
  }
  return found;
}

export function detectFrozenCollisions(self: BranchDiff, others: BranchDiff[]): Collision[] {
  const mine = new Set(self.changed.filter((p) => startsWithAny(p, FROZEN_PREFIXES)));
  const found: Collision[] = [];
  for (const other of others) {
    for (const path of other.changed) {
      if (!mine.has(path)) continue;
      found.push({
        kind: "frozen-file",
        other: other.branch,
        path,
        detail:
          `\`${other.branch}\` also changes this file. It is frozen after the PM's first ` +
          `commit, so whichever branch merges second cannot adapt to the first — the ` +
          `contract has to be reconciled before either lands.`,
      });
    }
  }
  return found;
}

export function detectSharedTestCollisions(self: BranchDiff, others: BranchDiff[]): Collision[] {
  const mine = new Set(self.changed.filter((p) => startsWithAny(p, SHARED_TEST_PREFIXES)));
  const found: Collision[] = [];
  for (const other of others) {
    for (const path of other.changed) {
      if (!mine.has(path)) continue;
      found.push({
        kind: "shared-test-helper",
        other: other.branch,
        path,
        detail:
          `\`${other.branch}\` also edits this helper. Every suite in the repo loads it, so ` +
          `the blast radius is the whole test run and a silent merge of both edits is not safe.`,
      });
    }
  }
  return found;
}

/**
 * `importers` maps a path this branch deletes to the branches that still import
 * it. Resolving an import is a question about file contents, so the runtime
 * answers it and this only decides what it means.
 */
export function detectDeletedModuleCollisions(
  self: BranchDiff,
  importers: Map<string, string[]>,
): Collision[] {
  const found: Collision[] = [];
  for (const path of self.deleted) {
    for (const branch of importers.get(path) ?? []) {
      found.push({
        kind: "deleted-module-still-imported",
        other: branch,
        path,
        detail:
          `\`${branch}\` still imports this module. Deleting it here breaks that branch the ` +
          `moment this merges, and its own CI cannot see the deletion because it reviews ` +
          `against main.`,
      });
    }
  }
  return found;
}

/** Source files whose imports can bind a deleted module. */
const SOURCE_FILE = /\.(ts|tsx|js|jsx)$/;

/**
 * Which sibling branches still import each module this branch deletes.
 *
 * The question is scoped to each sibling's OWN diff, never its whole tree.
 * Every factory branch is cut from main, so a tree-wide grep finds main's
 * importers on every sibling and reports a collision against all of them —
 * which is what #334 hit: deleting `src/lib/fee-runway.ts` and its banner
 * raised ten collisions across five branches, not one of which touched either
 * file or anything importing them. That verdict is unreachable by
 * construction: any branch deleting a module main still uses collides with
 * every open branch at once, so the check cannot go green while one exists and
 * the only way to satisfy it is to stop deleting.
 *
 * A sibling breaks only if its own work imports the module. If it never
 * touches an importing file, this deletion lands on main first — rewriting the
 * importers as part of the same change — and the sibling then merges with no
 * reference left to bind.
 *
 * `grep` answers "does `branch` mention `spec` in any of `paths`", injected so
 * the rule is exercised in a test rather than only in anger on a PR.
 */
export function resolveImporters(
  self: BranchDiff,
  others: BranchDiff[],
  specsOf: (path: string) => string[],
  grep: (spec: string, branch: string, paths: string[]) => boolean,
): Map<string, string[]> {
  const importers = new Map<string, string[]>();
  for (const path of self.deleted) {
    if (!SOURCE_FILE.test(path)) continue;
    const specs = specsOf(path);
    const found: string[] = [];
    for (const sibling of others) {
      const searchable = sibling.changed.filter((f) => SOURCE_FILE.test(f));
      if (searchable.length === 0) continue;
      if (specs.some((spec) => grep(spec, sibling.branch, searchable))) {
        found.push(sibling.branch);
      }
    }
    if (found.length > 0) importers.set(path, found);
  }
  return importers;
}

export function detectAll(
  self: BranchDiff,
  others: BranchDiff[],
  mainMigrations: string[],
  importers: Map<string, string[]>,
): Collision[] {
  return [
    ...detectMigrationCollisions(self, others, mainMigrations),
    ...detectMigrationWatermark(self, mainMigrations),
    ...detectFrozenCollisions(self, others),
    ...detectSharedTestCollisions(self, others),
    ...detectDeletedModuleCollisions(self, importers),
  ];
}

/**
 * The import specifiers a deleted file could be referenced by. Deliberately
 * narrow and deliberately documented: the `@/` alias and the extensionless
 * repo-relative path are what this repo actually writes. Relative imports from
 * a sibling directory are NOT resolved, so this check can miss — it is a net
 * for the common case, not a proof of safety, and the report says so.
 */
export function importSpecifiers(path: string): string[] {
  const withoutExt = path.replace(/\.(ts|tsx|js|jsx)$/, "");
  const specs = new Set<string>([withoutExt]);
  if (withoutExt.startsWith("src/")) {
    specs.add(`@/${withoutExt.slice("src/".length)}`);
  }
  const index = withoutExt.replace(/\/index$/, "");
  if (index !== withoutExt) {
    specs.add(index);
    if (index.startsWith("src/")) specs.add(`@/${index.slice("src/".length)}`);
  }
  return [...specs];
}

export function renderReport(
  collisions: Collision[],
  scanned: string[],
  unreadable: string[] = [],
): string {
  const lines: string[] = ["## Cross-branch collisions", ""];
  lines.push(
    scanned.length > 0
      ? `Compared against ${scanned.length} other open factory branch(es): ${scanned.map((b) => `\`${b}\``).join(", ")}.`
      : "No other open factory branches to compare against.",
  );
  lines.push("");

  // Reported before the findings, never folded into them. These branches were
  // NOT compared, so nothing below says anything about them.
  if (unreadable.length > 0) {
    lines.push(
      `> **${unreadable.length} branch(es) could not be compared** and are excluded from everything below: ` +
        `${unreadable.map((b) => `\`${b}\``).join(", ")}. A branch with no merge base against the base branch ` +
        `has unrelated history and cannot merge at all, which is a problem in its own right — this PR is not ` +
        `blocked by it, but a clean result here does not cover it.`,
    );
    lines.push("");
  }

  if (collisions.length === 0) {
    lines.push("No collisions found.");
    lines.push("");
    lines.push(
      "_This checks migration versions, frozen files, shared test helpers and deleted modules. " +
        "Import resolution covers `@/` and repo-relative specifiers only, so a relative import of a " +
        "deleted module can still slip through — a clean result here is a net, not a proof._",
    );
    return lines.join("\n");
  }

  const byKind = new Map<CollisionKind, Collision[]>();
  for (const c of collisions) {
    byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  }
  const titles: Record<CollisionKind, string> = {
    "migration-version": "Migration version already claimed",
    "migration-below-watermark": "Migration numbered below what main has applied",
    "frozen-file": "Frozen file also changed by another open branch",
    "shared-test-helper": "Shared test helper also edited by another open branch",
    "deleted-module-still-imported": "Deletes a module another open branch imports",
  };

  lines.push(`**${collisions.length} collision(s).** Every one is a conflict that appears at merge, not at review.`);
  lines.push("");
  for (const [kind, items] of byKind) {
    lines.push(`### ${titles[kind]}`);
    lines.push("");
    for (const c of items) {
      lines.push(`- \`${c.path}\` — ${c.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------- runtime

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return "";
  }
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function diffOf(base: string, ref: string): BranchDiff {
  // Three dots: what the branch INTRODUCED since the merge base. A two-dot diff
  // compares tips, so everything merged to main after the branch was cut shows
  // up as though the branch had touched it — which here would report a collision
  // against every file main has moved since.
  // `git merge-base` is asked first and separately, so "no merge base" is
  // distinguishable from "no files changed". They produce identical output from
  // a failed diff and mean opposite things.
  if (git(["merge-base", base, ref]).trim() === "") {
    return { branch: ref.replace(/^origin\//, ""), changed: [], deleted: [], readable: false };
  }
  const raw = git(["diff", "--name-status", `${base}...${ref}`]);
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...rest] = line.split("\t");
    const path = rest[rest.length - 1];
    if (!path) continue;
    changed.push(path);
    if (status.startsWith("D")) deleted.push(path);
  }
  return { branch: ref.replace(/^origin\//, ""), changed, deleted, readable: true };
}

function main(): void {
  const base = `origin/${arg("base", process.env.GITHUB_BASE_REF || "main")}`;
  const headRef = arg("head", process.env.GITHUB_HEAD_REF || "");

  // Every branch, not just factory/*. See `selectSiblings` for why.
  git(["fetch", "--quiet", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
  git(["fetch", "--quiet", "origin", base.replace("origin/", "")]);

  const others = selectSiblings(
    git(["branch", "-r", "--no-merged", base, "--list", "origin/*"]).split("\n"),
    headRef,
  );

  // Always HEAD: on a pull_request event the checkout is the merge commit, which
  // is exactly what should be compared — the branch as it would land.
  const self = diffOf(base, "HEAD");
  self.branch = headRef || "HEAD";

  const allOthers = others.map((ref) => diffOf(base, ref));
  const otherDiffs = allOthers.filter((d) => d.readable);
  const unreadable = allOthers.filter((d) => !d.readable).map((d) => d.branch);
  const mainMigrations = git(["ls-tree", "-r", "--name-only", base, "--", MIGRATION_PREFIX])
    .split("\n")
    .filter(Boolean);

  const importers = resolveImporters(
    self,
    allOthers,
    importSpecifiers,
    (spec, branch, paths) => {
      const ref = `origin/${branch}`;
      const out =
        git(["grep", "-l", "-F", "-e", `"${spec}"`, ref, "--", ...paths]) +
        git(["grep", "-l", "-F", "-e", `'${spec}'`, ref, "--", ...paths]);
      return out.trim().length > 0;
    },
  );

  const collisions = detectAll(self, otherDiffs, mainMigrations, importers);
  const report = renderReport(
    collisions,
    otherDiffs.map((d) => d.branch),
    unreadable,
  );

  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
  }

  if (collisions.length > 0) {
    console.error(
      `::error::${collisions.length} cross-branch collision(s). These do not appear in this PR's own diff — each one is a conflict that lands on whoever merges second.`,
    );
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("cross-branch-collisions.ts")) main();
