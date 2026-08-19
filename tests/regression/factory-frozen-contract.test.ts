import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The Engineer may not rewrite the contract it is judged against. One file
 * under tests/acceptance is not that contract: the API-route registry, which
 * AGENTS.md requires new work to register through. Hashing it with the rest
 * made the freeze and the registration rule contradict each other, and a
 * complete LED-6 implementation was discarded for obeying the second (#257).
 *
 * These bind both halves: the freeze still holds on everything it protected
 * before, and the registry admits a registration while still refusing a
 * removal.
 */

const SCRIPT = resolve(__dirname, "../../scripts/factory/verify-frozen-contract.sh");
const REGISTRY = "tests/acceptance/99.test.ts";

const REGISTRY_BODY = `const CURRENT_PUBLIC_API_ROUTES = [
  "/api/stripe/webhook",
  "/api/cron/chase",
] as const;

const CURRENT_PROTECTED_API_ROUTES = [
  "/api/companies-house/search",
] as const;
`;

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/** A repo shaped like the real one: a frozen spec, a frozen test, a registry. */
const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "frozen-"));
  dirs.push(dir);

  mkdirSync(join(dir, "tests/acceptance"), { recursive: true });
  mkdirSync(join(dir, "docs/specs"), { recursive: true });
  writeFileSync(join(dir, REGISTRY), REGISTRY_BODY);
  writeFileSync(join(dir, "tests/acceptance/257.test.ts"), "// the item's contract\n");
  writeFileSync(join(dir, "docs/specs/257.md"), "# spec\n");

  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "spec");

  return dir;
};

type Result = { ok: boolean; output: string };

const record = (dir: string): void => {
  execFileSync("bash", [SCRIPT, "record", join(dir, "before.txt")], { cwd: dir });
};

const verify = (dir: string): Result => {
  const base = git(dir, "rev-parse", "HEAD").trim();
  try {
    const output = execFileSync(
      "bash",
      [SCRIPT, "verify", join(dir, "before.txt"), base],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    return { ok: false, output: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
};

describe("the frozen contract still holds", () => {
  it("passes when nothing was touched", () => {
    const dir = makeRepo();
    record(dir);

    expect(verify(dir).ok).toBe(true);
  });

  it("rejects an edit to the item's acceptance tests", () => {
    const dir = makeRepo();
    record(dir);
    writeFileSync(join(dir, "tests/acceptance/257.test.ts"), "// rewritten to pass\n");

    const result = verify(dir);

    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/contract this work is judged against/);
  });

  it("rejects an edit to the item's spec", () => {
    const dir = makeRepo();
    record(dir);
    writeFileSync(join(dir, "docs/specs/257.md"), "# spec, but easier\n");

    expect(verify(dir).ok).toBe(false);
  });
});

describe("the route registry admits a registration", () => {
  it("permits an added route and says so loudly", () => {
    const dir = makeRepo();
    record(dir);
    // Exactly what LED-6's Engineer did, and was blocked for.
    writeFileSync(
      join(dir, REGISTRY),
      REGISTRY_BODY.replace(
        '  "/api/companies-house/search",\n',
        '  "/api/companies-house/search",\n  "/api/ledger/query-session",\n',
      ),
    );

    const result = verify(dir);

    expect(result.ok).toBe(true);
    // The addition is not passed over in silence — a human is meant to see a
    // route being classified.
    expect(result.output).toMatch(/::warning::/);
    expect(result.output).toMatch(/query-session/);
  });

  it("permits a registration the agent already committed", () => {
    const dir = makeRepo();
    record(dir);
    writeFileSync(join(dir, REGISTRY), `${REGISTRY_BODY}// another route\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "register route");

    // Diffed against the recorded base, so committing it does not hide it.
    // The base is HEAD~1 now, which is what the workflow records before the
    // agent runs.
    const base = git(dir, "rev-parse", "HEAD~1").trim();
    const output = execFileSync(
      "bash",
      [SCRIPT, "verify", join(dir, "before.txt"), base],
      { cwd: dir, encoding: "utf8" },
    );

    expect(output).toMatch(/::warning::/);
  });

  it("still refuses a route being removed from the registry's view", () => {
    const dir = makeRepo();
    record(dir);
    writeFileSync(
      join(dir, REGISTRY),
      REGISTRY_BODY.replace('  "/api/stripe/webhook",\n', ""),
    );

    const result = verify(dir);

    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/removed or rewrote/);
  });

  it("still refuses an existing line being rewritten", () => {
    const dir = makeRepo();
    record(dir);
    // Moving a route from protected to public is a modification, not an
    // addition, and is exactly the edit the freeze exists to catch.
    writeFileSync(
      join(dir, REGISTRY),
      REGISTRY_BODY.replace(
        '  "/api/companies-house/search",',
        '  "/api/companies-house/search", // now public',
      ),
    );

    expect(verify(dir).ok).toBe(false);
  });
});

describe("the workflow calls the guard rather than reimplementing it", () => {
  it("wires both steps to the script", () => {
    const workflow = readFileSync(
      resolve(__dirname, "../../.github/workflows/factory-engineer.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "./scripts/factory/verify-frozen-contract.sh record /tmp/protected-before.txt",
    );
    expect(workflow).toMatch(/verify-frozen-contract\.sh[\s\\]+verify/);
    // The registry has to survive the chmod, or the intended path is closed.
    expect(workflow).toContain("chmod u+w tests/acceptance/99.test.ts");
  });
});
