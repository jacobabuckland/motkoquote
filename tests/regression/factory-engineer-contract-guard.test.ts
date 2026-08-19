import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The Engineer enforces contract immutability twice — against the working tree
 * and by walking its own commits — and both used a bare grep over the frozen
 * paths. That rejected the one edit AGENTS.md requires: registering a new API
 * route in tests/acceptance/99.test.ts. Two complete implementations of #257
 * were discarded for it.
 *
 * These bind that both checks now agree with the CI carve-out, and that the
 * freeze is otherwise untouched.
 */

const REPO = resolve(__dirname, "../..");
const GUARD = "scripts/factory/engineer-contract-guard.ts";
const REGISTRY = "tests/acceptance/99.test.ts";

const REGISTRY_BODY = `const CURRENT_PUBLIC_API_ROUTES = [
  "/api/stripe/webhook",
] as const;

const CURRENT_PROTECTED_API_ROUTES = [
  "/api/companies-house/search",
] as const;

it("classifies every route", () => {
  expect(CURRENT_PUBLIC_API_ROUTES.length).toBeGreaterThan(0);
});
`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/** A repo with the real guard in it, a frozen contract, and the registry. */
const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "eng-guard-"));
  dirs.push(dir);

  mkdirSync(join(dir, "tests/acceptance"), { recursive: true });
  mkdirSync(join(dir, "docs/specs"), { recursive: true });
  mkdirSync(join(dir, "scripts/factory"), { recursive: true });
  mkdirSync(join(dir, "scripts/ci"), { recursive: true });

  // The guard and the classifier it reuses, copied verbatim — the test drives
  // the real files, not a transcription of them.
  cpSync(join(REPO, GUARD), join(dir, GUARD));
  cpSync(
    join(REPO, "scripts/ci/acceptance-immutability.ts"),
    join(dir, "scripts/ci/acceptance-immutability.ts"),
  );

  writeFileSync(join(dir, REGISTRY), REGISTRY_BODY);
  writeFileSync(join(dir, "tests/acceptance/257.test.ts"), "// the contract\n");
  writeFileSync(join(dir, "docs/specs/257.md"), "# spec\n");

  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "spec");

  return dir;
};

type Result = { ok: boolean; stdout: string; stderr: string };

// spawnSync rather than execFileSync: stderr carries the registry notices, and
// execFileSync only hands it back on failure.
const run = (dir: string, ...args: string[]): Result => {
  const proc = spawnSync("npx", ["tsx", GUARD, ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  return {
    ok: proc.status === 0,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
};

const registerRoute = (dir: string): void => {
  writeFileSync(
    join(dir, REGISTRY),
    REGISTRY_BODY.replace(
      '  "/api/companies-house/search",\n',
      '  // Added by #257 (LED-6). Authenticated.\n  "/api/ledger/query-session",\n  "/api/companies-house/search",\n',
    ),
  );
};

describe("working-tree check", () => {
  it("passes a clean tree", () => {
    const dir = makeRepo();
    run(dir, "record", join(dir, "before.txt"));
    const base = git(dir, "rev-parse", "HEAD").trim();

    expect(run(dir, "working-tree", join(dir, "before.txt"), base).ok).toBe(true);
  });

  it("still refuses an edit to the item's acceptance test", () => {
    const dir = makeRepo();
    run(dir, "record", join(dir, "before.txt"));
    const base = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "tests/acceptance/257.test.ts"), "// rewritten to pass\n");

    const result = run(dir, "working-tree", join(dir, "before.txt"), base);

    expect(result.ok).toBe(false);
    expect(result.stdout).toMatch(/contract this work is judged against/);
  });

  it("still refuses an edit to the item's spec", () => {
    const dir = makeRepo();
    run(dir, "record", join(dir, "before.txt"));
    const base = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "docs/specs/257.md"), "# spec, but easier\n");

    expect(run(dir, "working-tree", join(dir, "before.txt"), base).ok).toBe(false);
  });

  it("permits registering a route, and says so", () => {
    const dir = makeRepo();
    run(dir, "record", join(dir, "before.txt"));
    const base = git(dir, "rev-parse", "HEAD").trim();
    registerRoute(dir);

    const result = run(dir, "working-tree", join(dir, "before.txt"), base);

    expect(result.ok).toBe(true);
    expect(result.stderr).toMatch(/::notice::Registry entry added/);
  });

  it("refuses a route being removed from the registry", () => {
    const dir = makeRepo();
    run(dir, "record", join(dir, "before.txt"));
    const base = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(
      join(dir, REGISTRY),
      REGISTRY_BODY.replace('  "/api/stripe/webhook",\n', ""),
    );

    expect(run(dir, "working-tree", join(dir, "before.txt"), base).ok).toBe(false);
  });

  it("refuses code being added to the registry, not just entries", () => {
    const dir = makeRepo();
    run(dir, "record", join(dir, "before.txt"));
    const base = git(dir, "rev-parse", "HEAD").trim();
    // The carve-out lists routes; it does not let the Engineer touch the
    // machinery that checks them.
    writeFileSync(join(dir, REGISTRY), `${REGISTRY_BODY}\nit.skip("disabled", () => {});\n`);

    expect(run(dir, "working-tree", join(dir, "before.txt"), base).ok).toBe(false);
  });
});

describe("commits check", () => {
  const commitAll = (dir: string, message: string): void => {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", message);
  };

  it("reports nothing when no frozen file was committed", () => {
    const dir = makeRepo();
    const before = git(dir, "rev-parse", "HEAD").trim();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/thing.ts"), "export const a = 1;\n");
    commitAll(dir, "implement");
    const after = git(dir, "rev-parse", "HEAD").trim();

    expect(run(dir, "commits", before, after).stdout.trim()).toBe("");
  });

  it("reports a committed edit to the item's acceptance test", () => {
    const dir = makeRepo();
    const before = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "tests/acceptance/257.test.ts"), "// rewritten\n");
    commitAll(dir, "adjust the contract");
    const after = git(dir, "rev-parse", "HEAD").trim();

    expect(run(dir, "commits", before, after).stdout).toContain(
      "tests/acceptance/257.test.ts",
    );
  });

  it("does not report a committed route registration", () => {
    const dir = makeRepo();
    const before = git(dir, "rev-parse", "HEAD").trim();
    registerRoute(dir);
    commitAll(dir, "register the route");
    const after = git(dir, "rev-parse", "HEAD").trim();

    const result = run(dir, "commits", before, after);

    // stdout is what the workflow captures as offending — it must be empty,
    // with the notice kept off it.
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toMatch(/::notice::Registry entry added/);
  });

  it("reports a route removed in a commit", () => {
    const dir = makeRepo();
    const before = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(
      join(dir, REGISTRY),
      REGISTRY_BODY.replace('  "/api/stripe/webhook",\n', ""),
    );
    commitAll(dir, "quietly drop a route");
    const after = git(dir, "rev-parse", "HEAD").trim();

    expect(run(dir, "commits", before, after).stdout).toContain(REGISTRY);
  });

  it("catches a frozen file changed and restored across two commits", () => {
    const dir = makeRepo();
    const before = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "docs/specs/257.md"), "# easier\n");
    commitAll(dir, "loosen");
    writeFileSync(join(dir, "docs/specs/257.md"), "# spec\n");
    commitAll(dir, "put it back");
    const after = git(dir, "rev-parse", "HEAD").trim();

    // Nets to nothing between the tips, but the contract was rewritten on the
    // way — which is why the walk is per-commit.
    expect(run(dir, "commits", before, after).stdout).toContain("docs/specs/257.md");
  });
});

describe("the workflow routes every check through this guard", () => {
  it("wires all three call sites", () => {
    const workflow = readFileSync(
      join(REPO, ".github/workflows/factory-engineer.yml"),
      "utf8",
    );

    expect(workflow).toMatch(/engineer-contract-guard\.ts record/);
    expect(workflow).toMatch(/engineer-contract-guard\.ts[\s\\]+working-tree/);
    expect(workflow).toMatch(/engineer-contract-guard\.ts[\s\\]+commits/);
    // The bare greps these replaced must be gone, or the rule means two things.
    expect(workflow).not.toMatch(/grep -E '\^\(docs\/specs\/\|tests\/acceptance\/\)'/);
  });
});
