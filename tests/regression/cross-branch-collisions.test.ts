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
  migrationVersion,
  renderReport,
  type BranchDiff,
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
