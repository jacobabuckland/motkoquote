import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// scripts/factory/push-branch.sh already refuses to lose work: `advance` pushes
// without force, and `--force-with-lease` is used only by `restart`, against the
// sha that run actually saw. None of it binds the agent. actions/checkout leaves
// credentials on the remote, so an agent can `git push --force` itself and skip
// the script entirely — factory-engineer.yml records that happening on #108.
//
// The hook is the mechanism for what the script can only ask for. Exercised
// against real git here, not asserted on its source: a guard nobody has watched
// refuse a push is a guard nobody knows works.

const HOOK = resolve("scripts/factory/pre-push-guard.sh");

function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** A remote plus a working clone with the hook installed. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "pre-push-guard-"));
  const remote = join(dir, "remote.git");
  const work = join(dir, "work");

  execFileSync("git", ["init", "-q", "--bare", remote]);
  execFileSync("git", ["init", "-q", work]);
  git(work, ["config", "user.email", "t@t.t"]);
  git(work, ["config", "user.name", "T"]);
  git(work, ["remote", "add", "origin", remote]);
  execFileSync("mkdir", ["-p", join(work, ".git", "hooks")]);
  execFileSync("install", ["-m", "0755", HOOK, join(work, ".git", "hooks", "pre-push")]);

  const commit = (message: string) => {
    execFileSync("sh", ["-c", `echo ${message} >> f`], { cwd: work });
    git(work, ["add", "-A"]);
    git(work, ["commit", "-qm", message]);
  };

  const push = (args: string[], env: Record<string, string> = {}) => {
    try {
      git(work, ["push", ...args], env);
      return { ok: true, err: "" };
    } catch (e) {
      const err = e as { stderr?: string };
      return { ok: false, err: err.stderr ?? "" };
    }
  };

  return { work, commit, push };
}

describe("the pre-push guard on a factory branch", () => {
  it("allows creating the branch", () => {
    const r = repo();
    r.commit("one");
    expect(r.push(["origin", "HEAD:refs/heads/factory/9"]).ok).toBe(true);
  });

  it("allows a fast-forward, which loses nothing", () => {
    const r = repo();
    r.commit("one");
    r.push(["origin", "HEAD:refs/heads/factory/9"]);
    r.commit("two");
    expect(r.push(["origin", "HEAD:refs/heads/factory/9"]).ok).toBe(true);
  });

  it("REFUSES a force-push that would discard the remote's commits", () => {
    // The stale agent: it holds a checkout from before a re-derivation, and
    // force-pushing restores the superseded lineage — including the old
    // acceptance tests, which no later commit may repair.
    const r = repo();
    r.commit("one");
    r.push(["origin", "HEAD:refs/heads/factory/9"]);
    r.commit("two");
    r.push(["origin", "HEAD:refs/heads/factory/9"]);
    git(r.work, ["reset", "-q", "--hard", "HEAD~1"]);
    r.commit("stale-work");

    const result = r.push(["--force", "origin", "HEAD:refs/heads/factory/9"]);
    expect(result.ok).toBe(false);
    expect(result.err).toContain("REFUSED");
    expect(result.err).toContain("would discard commits");
  });

  it("lets push-branch.sh through, which has already checked its lease", () => {
    // `restart` rewrites a factory branch deliberately — that is how a
    // re-derivation replaces a spec commit. A hook that refused it would break
    // the mechanism it exists to protect.
    const r = repo();
    r.commit("one");
    r.push(["origin", "HEAD:refs/heads/factory/9"]);
    r.commit("two");
    r.push(["origin", "HEAD:refs/heads/factory/9"]);
    git(r.work, ["reset", "-q", "--hard", "HEAD~1"]);
    r.commit("new-derivation");

    const result = r.push(["--force", "origin", "HEAD:refs/heads/factory/9"], {
      FACTORY_PUSH_GUARD: "allow",
    });
    expect(result.ok).toBe(true);
  });

  it("ignores branches that are not factory/*", () => {
    // It guards the frozen-contract mechanism, not the repository at large.
    const r = repo();
    r.commit("one");
    r.push(["origin", "HEAD:refs/heads/scratch"]);
    r.commit("two");
    r.push(["origin", "HEAD:refs/heads/scratch"]);
    git(r.work, ["reset", "-q", "--hard", "HEAD~1"]);
    r.commit("rewritten");

    expect(r.push(["--force", "origin", "HEAD:refs/heads/scratch"]).ok).toBe(true);
  });

  it("allows deleting a factory branch", () => {
    const r = repo();
    r.commit("one");
    r.push(["origin", "HEAD:refs/heads/factory/9"]);
    expect(r.push(["origin", "--delete", "refs/heads/factory/9"]).ok).toBe(true);
  });
});

describe("push-branch.sh declares itself to the guard", () => {
  it("exports FACTORY_PUSH_GUARD before it pushes", () => {
    // Without this the script's own `restart` force-with-lease would be refused
    // by the hook, and re-derivation would stop working entirely.
    const source = execFileSync("cat", ["scripts/factory/push-branch.sh"], { encoding: "utf8" });
    expect(source).toContain("FACTORY_PUSH_GUARD=allow");
  });
});
