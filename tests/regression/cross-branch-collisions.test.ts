import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FROZEN_PREFIXES,
  compareVersions,
  detectMigrationWatermark,
  highestMigrationVersion,
  SHARED_TEST_PREFIXES,
  detectAll,
  detectDeletedModuleCollisions,
  detectFrozenCollisions,
  detectMigrationCollisions,
  detectSharedTestCollisions,
  importSpecifiers,
  resolveImporters,
  migrationVersion,
  renderReport,
  type BranchDiff,
  selectSiblings,
} from "@/../scripts/ci/cross-branch-collisions";

const branch = (name: string, changed: string[], deleted: string[] = []): BranchDiff => ({
  branch: name,
  changed,
  deleted,
  readable: true,
});

describe("migration versions", () => {
  it("reads the version a filename claims", () => {
    expect(migrationVersion("supabase/migrations/20260818120000_add_x.sql")).toBe("20260818120000");
    expect(migrationVersion("supabase/migrations/nonsense.sql")).toBeNull();
    expect(migrationVersion("src/lib/thing.ts")).toBeNull();
  });

  it("catches two open branches claiming the same version", () => {
    const found = detectMigrationCollisions(
      branch("factory/1", ["supabase/migrations/20260818120000_mine.sql"]),
      [branch("factory/2", ["supabase/migrations/20260818120000_theirs.sql"])],
      [],
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "migration-version", other: "factory/2" });
  });

  it("catches a version main has already used", () => {
    const found = detectMigrationCollisions(
      branch("factory/1", ["supabase/migrations/20260818120000_mine.sql"]),
      [],
      ["supabase/migrations/20260818120000_landed.sql"],
    );
    expect(found[0]).toMatchObject({ other: "main" });
  });

  // A branch carrying a migration that has since landed on main, unchanged, is
  // resolved by the merge. Reporting it would fail every branch that is merely
  // behind, which is most of them.
  it("does not flag the identical migration already on main", () => {
    const path = "supabase/migrations/20260818120000_same.sql";
    expect(detectMigrationCollisions(branch("factory/1", [path]), [], [path])).toHaveLength(0);
  });

  it("does not flag different versions", () => {
    const found = detectMigrationCollisions(
      branch("factory/1", ["supabase/migrations/20260818120000_a.sql"]),
      [branch("factory/2", ["supabase/migrations/20260819090000_b.sql"])],
      [],
    );
    expect(found).toHaveLength(0);
  });
});

describe("a migration numbered below what main has already applied", () => {
  // Main's real state on 18 August: 32-35, 37 and 40 applied, while three
  // unmerged branches sat on 36, 38 and 39. Each was out of order the moment it
  // merged, and the same-version check could not see any of them.
  const MAIN = [
    "supabase/migrations/00000000000032_a.sql",
    "supabase/migrations/00000000000035_b.sql",
    "supabase/migrations/00000000000037_c.sql",
    "supabase/migrations/00000000000040_d.sql",
  ];

  it("reads the high-water mark off main", () => {
    expect(highestMigrationVersion(MAIN)).toBe("00000000000040");
    expect(highestMigrationVersion([])).toBeNull();
    expect(highestMigrationVersion(["src/lib/x.ts"])).toBeNull();
  });

  it("compares versions numerically, not by raw string order", () => {
    expect(compareVersions("00000000000009", "00000000000010")).toBeLessThan(0);
    expect(compareVersions("9", "10")).toBeLessThan(0);
    expect(compareVersions("00000000000040", "00000000000040")).toBe(0);
  });

  it("flags each of the three real cases", () => {
    for (const version of ["00000000000036", "00000000000038", "00000000000039"]) {
      const found = detectMigrationWatermark(
        branch("factory/1", [`supabase/migrations/${version}_x.sql`]),
        MAIN,
      );
      expect(found, version).toHaveLength(1);
      expect(found[0].detail).toContain("00000000000040");
      expect(found[0].detail).toContain("Renumber");
    }
  });

  it("says nothing about a migration numbered above the mark", () => {
    expect(
      detectMigrationWatermark(
        branch("factory/1", ["supabase/migrations/00000000000041_x.sql"]),
        MAIN,
      ),
    ).toHaveLength(0);
  });

  // Being behind main is not a defect. A branch carrying a migration that has
  // already landed, unchanged, resolves at merge.
  it("says nothing about a migration already on main", () => {
    expect(
      detectMigrationWatermark(branch("factory/1", [MAIN[0]]), MAIN),
    ).toHaveLength(0);
  });

  it("says nothing when main has no migrations at all", () => {
    expect(
      detectMigrationWatermark(
        branch("factory/1", ["supabase/migrations/00000000000001_x.sql"]),
        [],
      ),
    ).toHaveLength(0);
  });

  it("is reported by detectAll and rendered under its own heading", () => {
    const found = detectAll(
      branch("factory/1", ["supabase/migrations/00000000000038_x.sql"]),
      [],
      MAIN,
      new Map(),
    );
    expect(found).toHaveLength(1);
    expect(renderReport(found, [])).toContain("Migration numbered below what main has applied");
  });
});

describe("frozen files", () => {
  it("catches two branches changing the same frozen file", () => {
    for (const prefix of FROZEN_PREFIXES) {
      const path = `${prefix}shared.ts`;
      const found = detectFrozenCollisions(branch("factory/1", [path]), [branch("factory/2", [path])]);
      expect(found, `${prefix} should be watched`).toHaveLength(1);
      expect(found[0].detail).toContain("merges second");
    }
  });

  it("does not flag each branch's own spec and tests", () => {
    const found = detectFrozenCollisions(
      branch("factory/1", ["docs/specs/1.md", "tests/acceptance/1.test.ts"]),
      [branch("factory/2", ["docs/specs/2.md", "tests/acceptance/2.test.ts"])],
    );
    expect(found).toHaveLength(0);
  });
});

describe("shared test infrastructure", () => {
  // The real one: factory/127 and factory/140 both edit tests/setup.ts, which
  // every suite in the repo loads, and #140 is sitting at previewed waiting to
  // merge. Neither branch's CI can see the other.
  it("catches two branches editing tests/setup.ts", () => {
    const found = detectSharedTestCollisions(
      branch("factory/140", ["tests/setup.ts"]),
      [branch("factory/127", ["tests/setup.ts"])],
    );
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("blast radius");
  });

  it("watches every shared prefix it claims to", () => {
    for (const prefix of SHARED_TEST_PREFIXES) {
      const path = prefix.endsWith("/") ? `${prefix}capacitor.ts` : prefix;
      const found = detectSharedTestCollisions(
        branch("factory/1", [path]),
        [branch("factory/2", [path])],
      );
      expect(found, `${prefix} should be watched`).toHaveLength(1);
    }
  });

  it("leaves a per-item regression test alone", () => {
    const found = detectSharedTestCollisions(
      branch("factory/1", ["tests/regression/mine.test.ts"]),
      [branch("factory/2", ["tests/regression/theirs.test.ts"])],
    );
    expect(found).toHaveLength(0);
  });
});

describe("deleting a module another branch still imports", () => {
  it("reports the branch that would break", () => {
    const found = detectDeletedModuleCollisions(
      branch("factory/1", ["src/lib/old.ts"], ["src/lib/old.ts"]),
      new Map([["src/lib/old.ts", ["factory/2", "factory/3"]]]),
    );
    expect(found).toHaveLength(2);
    expect(found[0].detail).toContain("reviews against main");
  });

  it("says nothing when no other branch imports it", () => {
    expect(
      detectDeletedModuleCollisions(
        branch("factory/1", ["src/lib/old.ts"], ["src/lib/old.ts"]),
        new Map(),
      ),
    ).toHaveLength(0);
  });

  it("resolves the specifiers this repo actually writes", () => {
    expect(importSpecifiers("src/lib/quote.ts")).toContain("@/lib/quote");
    expect(importSpecifiers("src/lib/quote.ts")).toContain("src/lib/quote");
    expect(importSpecifiers("src/components/ui/index.tsx")).toContain("@/components/ui");
  });
});

describe("which sibling branches are compared", () => {
  // The hole this closes. On 31 Aug factory/475 and
  // claude/public-surface-migrations both claimed migration 00000000000054, and
  // BOTH runs passed — the check fetched and listed `origin/factory/*` only, so
  // neither branch could see the other. The migration-version rule was working
  // perfectly and pointed at a third of the problem.
  const REAL_BRANCHES = [
    "  origin/HEAD -> origin/main",
    "  origin/factory/475",
    "  origin/factory/466",
    "  origin/claude/public-surface-migrations",
    "  origin/claude/agents-db-access-posture",
    "  origin/archive/239-pre-rederive",
    "  origin/archive/300-ambiguous-spec",
    "  origin/factory-state",
    "",
  ];

  it("compares against non-factory branches, which is the whole point", () => {
    const picked = selectSiblings(REAL_BRANCHES, "factory/475");
    expect(picked).toContain("origin/claude/public-surface-migrations");
    expect(picked).toContain("origin/claude/agents-db-access-posture");
  });

  it("still compares against factory branches", () => {
    expect(selectSiblings(REAL_BRANCHES, "claude/x")).toContain("origin/factory/475");
  });

  it("never compares a branch against itself", () => {
    expect(selectSiblings(REAL_BRANCHES, "factory/475")).not.toContain("origin/factory/475");
  });

  it("skips archive/, which is parked by convention and will not merge", () => {
    const picked = selectSiblings(REAL_BRANCHES, "factory/475");
    expect(picked.filter((b) => b.includes("archive/"))).toEqual([]);
  });

  it("skips factory-state, which shares no history with main", () => {
    // An orphan branch three-dot-diffs as "every file changed", so leaving it in
    // would report a collision on everything, every run.
    expect(selectSiblings(REAL_BRANCHES, "factory/475")).not.toContain("origin/factory-state");
  });

  it("skips the symbolic HEAD line git prints", () => {
    const picked = selectSiblings(REAL_BRANCHES, "factory/475");
    expect(picked.some((b) => b.includes("->"))).toBe(false);
  });

  it("trims and drops blanks, since it is fed raw git output", () => {
    expect(selectSiblings(["  origin/factory/1  ", "", "   "], "x")).toEqual(["origin/factory/1"]);
  });

  it("would have caught the 31 Aug collision", () => {
    // The end-to-end claim, run through the real detector: two branches, two
    // different migrations, one version.
    const picked = selectSiblings(REAL_BRANCHES, "factory/475");
    expect(picked).toContain("origin/claude/public-surface-migrations");

    const collisions = detectMigrationCollisions(
      {
        branch: "factory/475",
        changed: ["supabase/migrations/00000000000054_processing_fee_columns.sql"],
        deleted: [],
        readable: true,
      },
      [
        {
          branch: "claude/public-surface-migrations",
          changed: ["supabase/migrations/00000000000054_public_surface_audit.sql"],
          deleted: [],
          readable: true,
        },
      ],
      [], // main carries no migration at this version, which is the real state
    );

    expect(collisions).toHaveLength(1);
    expect(collisions[0].kind).toBe("migration-version");
  });
});

describe("the report", () => {
  it("says a clean result is a net rather than a proof", () => {
    const out = renderReport([], ["factory/2"]);
    expect(out).toContain("No collisions found");
    expect(out).toContain("a net, not a proof");
  });

  // The scanner's own first bug: a branch it could not diff produced an empty
  // file list, which reads downstream as "collides with nothing". factory/132
  // has a different root commit from main and was silently excluded from every
  // comparison.
  it("names branches it could not compare, before any finding", () => {
    const out = renderReport([], ["factory/2"], ["factory/132"]);
    expect(out).toContain("could not be compared");
    expect(out).toContain("factory/132");
    expect(out.indexOf("could not be compared")).toBeLessThan(out.indexOf("No collisions found"));
  });

  it("groups findings by kind", () => {
    const out = renderReport(
      detectAll(
        branch("factory/1", ["tests/setup.ts", "supabase/migrations/20260818120000_a.sql"]),
        [branch("factory/2", ["tests/setup.ts", "supabase/migrations/20260818120000_b.sql"])],
        [],
        new Map(),
      ),
      ["factory/2"],
    );
    expect(out).toContain("Migration version already claimed");
    expect(out).toContain("Shared test helper");
    expect(out).toContain("2 collision(s)");
  });
});

describe("the runtime plumbing", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");

  it("CI runs the scanner this module lives in", () => {
    expect(ci).toContain("npx tsx scripts/ci/cross-branch-collisions.ts");
    expect(ci).toContain("cross-branch-collisions:");
  });

  it("the scanner job checks out full history, since the scan is three-dot", () => {
    const job = ci.slice(ci.indexOf("cross-branch-collisions:"), ci.indexOf("secret-scan:"));
    expect(job).toContain("fetch-depth: 0");
    expect(job).toContain("GITHUB_HEAD_REF");
  });

  // The fourth check needs scripts/ inside typecheck, and #188 already proved
  // that exclusion was hiding a real break. It was never removed on main — the
  // removal has been sitting on the unmerged factory/188 since 16 August.
  it("scripts/ is inside typecheck", () => {
    const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8")) as { exclude?: string[] };
    expect(tsconfig.exclude ?? []).not.toContain("scripts");
  });
});

describe("resolving which siblings import a deleted module", () => {
  // What each file contains, as git grep would find it. Every branch is cut
  // from main, so main's importer sits in all of their trees — that shared
  // inheritance is the whole trap.
  const CONTENTS: Record<string, string[]> = {
    "src/app/dashboard/page.tsx": ["@/lib/fee-runway"], // main's importer
    "src/lib/settle-paid-job.ts": [],
    "src/lib/paid-job-settlement.ts": [],
    "src/app/dashboard/banner.tsx": ["@/lib/fee-runway"],
  };
  const grep = (spec: string, _branch: string, paths: string[]): boolean =>
    paths.some((f) => (CONTENTS[f] ?? []).includes(spec));

  const specsOf = () => ["@/lib/fee-runway"];

  // #334's shape: it deletes fee-runway and rewrites the one file on main that
  // used it. Its siblings are off in settlement and marketing code and never
  // name it. Ten collisions were reported here, against five such branches.
  const self334 = branch(
    "factory/334",
    ["src/app/dashboard/page.tsx", "src/lib/fee-runway.ts", "src/components/ui/fee-runway-banner.tsx"],
    ["src/lib/fee-runway.ts", "src/components/ui/fee-runway-banner.tsx"],
  );
  const siblings334 = [
    branch("factory/330", ["src/lib/settle-paid-job.ts"]),
    branch("factory/331", ["src/lib/paid-job-settlement.ts"]),
    branch("factory/335", ["site/pricing.html"]),
  ];

  it("ignores a sibling whose own diff touches no importing file", () => {
    const importers = resolveImporters(self334, siblings334, specsOf, grep);

    expect(
      importers.size,
      "a module none of them touches must not collide with all of them",
    ).toBe(0);
    expect(detectDeletedModuleCollisions(self334, importers)).toHaveLength(0);
  });

  it("is the scoping that spares them, not the contents", () => {
    // The same siblings and the same contents, searched tree-wide the way the
    // runtime used to: each inherits main's importer, so each collides on work
    // it never did. This pins WHY the case above passes — a regression to a
    // tree-wide grep cannot quietly restore it. (factory/335 escapes even here,
    // because a branch of HTML and docs has no source file to search.)
    const treeWide = (spec: string, b: string) => grep(spec, b, Object.keys(CONTENTS));
    const importers = resolveImporters(self334, siblings334, specsOf, treeWide);
    expect(importers.get("src/lib/fee-runway.ts")).toEqual(["factory/330", "factory/331"]);
  });

  it("still catches a sibling that does import the deleted module", () => {
    const self = branch("factory/334", ["src/lib/fee-runway.ts"], ["src/lib/fee-runway.ts"]);
    const siblings = [
      branch("factory/240", ["src/app/dashboard/banner.tsx"]),
      branch("factory/335", ["site/pricing.html"]),
    ];

    const importers = resolveImporters(self, siblings, specsOf, grep);

    expect(importers.get("src/lib/fee-runway.ts")).toEqual(["factory/240"]);
    expect(detectDeletedModuleCollisions(self, importers)).toHaveLength(1);
  });

  it("does not search a sibling that changed no source files", () => {
    const self = branch("factory/334", ["src/lib/fee-runway.ts"], ["src/lib/fee-runway.ts"]);
    const searched: string[] = [];
    resolveImporters(
      self,
      [branch("factory/335", ["site/pricing.html", "docs/specs/335.md"])],
      specsOf,
      (_spec, b) => {
        searched.push(b);
        return true;
      },
    );
    expect(searched, "a docs-and-html branch has nothing that could import a module").toEqual([]);
  });

  it("ignores a deleted file that is not a source module", () => {
    const self = branch("factory/1", ["docs/old.md"], ["docs/old.md"]);
    const importers = resolveImporters(self, [branch("factory/2", ["src/a.ts"])], specsOf, () => true);
    expect(importers.size).toBe(0);
  });
});
