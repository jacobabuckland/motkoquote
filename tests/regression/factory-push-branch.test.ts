import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * #277. Two agents lost completed work to a push, in opposite ways.
 *
 * The PM cuts factory/N fresh from main on every needs-spec run, so every
 * re-derivation is a non-fast-forward and is rejected — #239, #269 and #300
 * each needed a human to archive and reset the branch by hand. The Engineer
 * races the PM the other way: it builds against a branch that moves under it,
 * and `fetch first` throws away a complete implementation.
 *
 * These drive the real script against real repositories, because the whole
 * subject is what git does at a diverged remote and a transcription of that
 * would only assert what the test author believed.
 */

const SCRIPT = resolve(__dirname, "../../scripts/factory/push-branch.sh");
const BRANCH = "factory/277";

// Each test runs several git subprocesses; the 5s default is not a budget for
// that once the suite is running in parallel.
const SPAWN_TIMEOUT_MS = 60_000;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

const temp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const commit = (dir: string, path: string, body: string, message: string) => {
  const full = join(dir, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, body);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
};

/** A bare remote carrying a single `main`, plus a working clone of it. */
const makeRemote = (): string => {
  const remote = temp("push-remote-");
  git(remote, "init", "-q", "--bare", "-b", "main");

  const seed = temp("push-seed-");
  git(seed, "init", "-q", "-b", "main");
  git(seed, "config", "user.email", "t@example.com");
  git(seed, "config", "user.name", "t");
  commit(seed, "README.md", "# repo\n", "init");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-q", "origin", "main");

  return remote;
};

const clone = (remote: string, prefix: string): string => {
  const dir = temp(prefix);
  git(dir, "clone", "-q", remote, ".");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  return dir;
};

type Result = { ok: boolean; log: string };

const push = (dir: string, mode: "restart" | "advance"): Result => {
  // Outside the clone, deliberately: a log written into the working tree gets
  // swept up by the next `git add -A` and then blocks the rebase it was
  // recording.
  const log = join(temp("push-log-"), "push.log");
  const proc = spawnSync("bash", [SCRIPT, BRANCH, mode], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PUSH_LOG: log },
  });
  return {
    ok: proc.status === 0,
    log: existsSync(log) ? readFileSync(log, "utf8") : "",
  };
};

const remoteTip = (remote: string): string =>
  git(remote, "rev-parse", BRANCH).trim();

const remoteFiles = (remote: string): string[] =>
  git(remote, "ls-tree", "-r", "--name-only", BRANCH).trim().split("\n");

/** The PM's move: cut the branch fresh from main and derive a spec onto it. */
const derive = (dir: string, spec: string): void => {
  git(dir, "checkout", "-q", "-B", BRANCH, "origin/main");
  mkdirSync(join(dir, "docs/specs"), { recursive: true });
  mkdirSync(join(dir, "tests/acceptance"), { recursive: true });
  writeFileSync(join(dir, "docs/specs/277.md"), spec);
  writeFileSync(join(dir, "tests/acceptance/277.test.ts"), `// ${spec}`);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "spec: derive");
};

describe("restart mode — the PM re-deriving", () => {
  it("creates the branch when the remote has none", () => {
    const remote = makeRemote();
    const pm = clone(remote, "push-pm-");
    derive(pm, "first derivation");

    expect(push(pm, "restart").ok).toBe(true);
    expect(remoteTip(remote)).toBe(git(pm, "rev-parse", "HEAD").trim());
  }, SPAWN_TIMEOUT_MS);

  it("replaces a branch that already carries a spec", () => {
    const remote = makeRemote();

    const first = clone(remote, "push-pm1-");
    derive(first, "first derivation");
    expect(push(first, "restart").ok).toBe(true);
    const firstTip = remoteTip(remote);

    // A second `needs-spec` run: a fresh clone, the branch cut from main
    // again, no knowledge of what is already there. Before #277 this is the
    // push that was rejected, and a human had to delete the branch.
    const second = clone(remote, "push-pm2-");
    derive(second, "second derivation");

    const result = push(second, "restart");

    expect(result.ok).toBe(true);
    expect(remoteTip(remote)).toBe(git(second, "rev-parse", "HEAD").trim());
    expect(remoteTip(remote)).not.toBe(firstTip);
    expect(
      git(remote, "show", `${BRANCH}:docs/specs/277.md`).trim(),
    ).toBe("second derivation");
  }, SPAWN_TIMEOUT_MS);

  it("refuses to overwrite a commit this run never saw", () => {
    const remote = makeRemote();

    const first = clone(remote, "push-pm1-");
    derive(first, "first derivation");
    expect(push(first, "restart").ok).toBe(true);

    const second = clone(remote, "push-pm2-");
    git(second, "checkout", "-q", BRANCH);
    derive(second, "second derivation");

    // The lease is the whole difference between this and a bare `--force`, so
    // the scenario has to be one where the two behave differently. Racing the
    // push does not: receive-pack compares against the oid it advertised, so a
    // plain force is refused there too. What only the lease catches is a stale
    // view — the branch moved and this run's remote-tracking ref never learned
    // it, so `--force` would silently destroy a commit the run never saw.
    //
    // Dropping the fetch refspec is how that state is reached here: `git fetch
    // origin <branch>` then resolves the branch into FETCH_HEAD and leaves
    // refs/remotes/origin/<branch> at the value it already had.
    const racer = clone(remote, "push-race-");
    derive(racer, "third derivation");
    git(racer, "push", "-q", "--force", "origin", `HEAD:refs/heads/${BRANCH}`);
    const racerTip = remoteTip(remote);
    git(second, "config", "--unset-all", "remote.origin.fetch");

    const result = push(second, "restart");

    expect(result.ok).toBe(false);
    expect(remoteTip(remote)).toBe(racerTip);
    expect(result.log).toMatch(/stale info|rejected/i);
  }, SPAWN_TIMEOUT_MS);
});

describe("advance mode — the Engineer racing", () => {
  it("rebases onto what landed underneath it and keeps both", () => {
    const remote = makeRemote();

    const pm = clone(remote, "push-pm-");
    derive(pm, "the contract");
    expect(push(pm, "restart").ok).toBe(true);

    // The Engineer picks the branch up and implements against it.
    const eng = clone(remote, "push-eng-");
    git(eng, "checkout", "-q", BRANCH);
    commit(eng, "src/feature.ts", "export const feature = true;\n", "feat: implement");

    // Something else lands on the branch while it works.
    git(pm, "pull", "-q", "--ff-only", "origin", BRANCH);
    commit(pm, "src/other.ts", "export const other = true;\n", "chore: other");
    git(pm, "push", "-q", "origin", BRANCH);

    const result = push(eng, "advance");

    expect(result.ok).toBe(true);
    const files = remoteFiles(remote);
    expect(files).toContain("src/feature.ts");
    expect(files).toContain("src/other.ts");
    expect(files).toContain("docs/specs/277.md");
  }, SPAWN_TIMEOUT_MS);

  it("pushes straight through when nothing moved", () => {
    const remote = makeRemote();

    const pm = clone(remote, "push-pm-");
    derive(pm, "the contract");
    expect(push(pm, "restart").ok).toBe(true);

    const eng = clone(remote, "push-eng-");
    git(eng, "checkout", "-q", BRANCH);
    commit(eng, "src/feature.ts", "export const feature = true;\n", "feat: implement");

    expect(push(eng, "advance").ok).toBe(true);
    expect(remoteTip(remote)).toBe(git(eng, "rev-parse", "HEAD").trim());
  }, SPAWN_TIMEOUT_MS);

  it("does not rebase a superseded contract back onto the branch", () => {
    const remote = makeRemote();

    const pm = clone(remote, "push-pm-");
    derive(pm, "first contract");
    expect(push(pm, "restart").ok).toBe(true);

    const eng = clone(remote, "push-eng-");
    git(eng, "checkout", "-q", BRANCH);
    commit(eng, "src/feature.ts", "export const feature = true;\n", "feat: implement");

    // The PM re-derives while the Engineer is mid-run, so the branch the
    // Engineer holds and the branch on the remote no longer share a spec
    // commit. Rebasing here would replay the superseded contract on top of
    // the live one — two copies of a file only the first commit may touch,
    // which the immutability guard then fails on a commit no agent is allowed
    // to repair. Refusing and saying why is the only honest outcome.
    const redo = clone(remote, "push-redo-");
    derive(redo, "second contract");
    expect(push(redo, "restart").ok).toBe(true);
    const redoTip = remoteTip(remote);

    const result = push(eng, "advance");

    expect(result.ok).toBe(false);
    expect(result.log).toContain("was restarted while this run was working");
    expect(remoteTip(remote)).toBe(redoTip);
    expect(
      git(remote, "show", `${BRANCH}:docs/specs/277.md`).trim(),
    ).toBe("second contract");
  }, SPAWN_TIMEOUT_MS);

  it("does not retry a rejection that is not a race, and keeps its reason", () => {
    const remote = makeRemote();

    const pm = clone(remote, "push-pm-");
    derive(pm, "the contract");
    expect(push(pm, "restart").ok).toBe(true);

    // Stands in for the class of rejection that is not a divergence at all —
    // #170's missing `workflow` token scope was one. Rebasing at it would bury
    // the reason under a second, more confusing failure.
    const hook = join(remote, "hooks/pre-receive");
    writeFileSync(
      hook,
      "#!/usr/bin/env bash\necho 'refusing to allow a Personal Access Token to update workflow' >&2\nexit 1\n",
    );
    chmodSync(hook, 0o755);

    const eng = clone(remote, "push-eng-");
    git(eng, "checkout", "-q", BRANCH);
    commit(eng, "src/feature.ts", "export const feature = true;\n", "feat: implement");

    const result = push(eng, "advance");

    expect(result.ok).toBe(false);
    expect(result.log).toContain("Personal Access Token");
    expect(result.log).not.toContain("rebasing onto");
  }, SPAWN_TIMEOUT_MS);
});

describe("both workflows route their pushes through it", () => {
  // #279's lesson: a rule with two enforcement points fixed at one of them is
  // not fixed. The PM has two push sites and the Engineer one, and a bare
  // `git push` at any of them is the defect #277 is about.
  const workflow = (name: string) =>
    readFileSync(resolve(__dirname, `../../.github/workflows/${name}`), "utf8");

  const runLines = (body: string): string[] =>
    body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("#"));

  it("leaves no bare push in the PM or the Engineer", () => {
    for (const name of ["factory-pm.yml", "factory-engineer.yml"]) {
      const bare = runLines(workflow(name)).filter((l) =>
        /^(if ! )?git push /.test(l),
      );
      expect(bare, `bare git push in ${name}`).toEqual([]);
    }
  });

  it("uses restart in the PM and advance in the Engineer", () => {
    const pm = workflow("factory-pm.yml");
    expect(pm).toContain('push-branch.sh "$BRANCH" restart');
    // Both outcomes — ambiguous and proceed — push, and both must go through it.
    expect(pm.match(/push_or_block/g)?.length).toBeGreaterThanOrEqual(3);

    expect(workflow("factory-engineer.yml")).toContain(
      'push-branch.sh "factory/$ISSUE" advance',
    );
  });

  it("blocks the item rather than exiting after the last label write", () => {
    // The PM's rejection path has to write its labels before it exits, or the
    // item stalls carrying needs-spec and looks like it is still being worked
    // on — which is how #239, #269 and #300 sat unnoticed.
    const pm = workflow("factory-pm.yml");
    const fn = pm.slice(pm.indexOf("push_or_block() {"));
    const body = fn.slice(0, fn.indexOf("\n          }"));

    expect(body).toContain("gh issue comment");
    expect(body).toContain("--add-label blocked --remove-label needs-spec");
    expect(body.indexOf("--add-label blocked")).toBeLessThan(
      body.lastIndexOf("exit 1"),
    );
  });
});
