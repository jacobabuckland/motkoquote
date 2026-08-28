import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// schema-drift-probe reported SUCCESS on every pull request while doing
// nothing, and had never run: both its secrets are unset, and probe() returns
// exitCode 0 on that path.
//
// It gives false assurance to precisely the reader who goes looking for it.
// CLAUDE.md says the migration ledger alone is not proof — a migration can be
// recorded as applied while its DDL never landed — and to confirm the column
// exists on production. Someone following that instruction lands on a green
// probe and reasonably concludes prod was checked. That happened on #387.
//
// probe() itself is NOT changed. tests/acceptance/225.test.ts is frozen and
// pins the absent-credentials path to exitCode 0, with the rationale that it
// must not block every PR on a check nobody has configured yet. So the fix is
// visibility plus a refusal where it actually matters, not a new exit code.

const runProbe = (env: Record<string, string>): string => {
  try {
    return execFileSync("npx", ["tsx", "scripts/ci/schema-probe.ts"], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
};

describe("the unconfigured skip is impossible to miss", () => {
  it("raises a GitHub warning annotation rather than a plain log line", () => {
    const out = runProbe({ SUPABASE_READONLY_URL: "", SUPABASE_READONLY_KEY: "" });
    expect(out).toContain("::warning");
    expect(out).toContain("did not run");
  });

  it("emits a machine-readable marker the workflow can branch on", () => {
    // A human reading the log is not enough — ci.yml has to be able to tell
    // "skipped because unconfigured" from "ran and found nothing", and those
    // are indistinguishable from the exit code alone.
    const out = runProbe({ SUPABASE_READONLY_URL: "", SUPABASE_READONLY_KEY: "" });
    expect(out).toContain("::probe-skipped-unconfigured::");
  });

  it("still exits zero, because a frozen test pins that path", () => {
    // Changing this would break tests/acceptance/225.test.ts, which nothing
    // downstream is permitted to repair. The visibility problem is solved
    // without touching the contract.
    let status = 0;
    try {
      execFileSync("npx", ["tsx", "scripts/ci/schema-probe.ts"], {
        encoding: "utf8",
        env: { ...process.env, SUPABASE_READONLY_URL: "", SUPABASE_READONLY_KEY: "" },
      });
    } catch (err) {
      status = (err as { status?: number }).status ?? 1;
    }
    expect(status).toBe(0);
  });

  it("still fails closed when only one secret is set", () => {
    // Pre-existing behaviour, asserted so it is not lost: one without the other
    // is a genuine misconfiguration, not a skip.
    let status = 0;
    try {
      execFileSync("npx", ["tsx", "scripts/ci/schema-probe.ts"], {
        encoding: "utf8",
        env: { ...process.env, SUPABASE_READONLY_URL: "https://x", SUPABASE_READONLY_KEY: "" },
      });
    } catch (err) {
      status = (err as { status?: number }).status ?? 1;
    }
    expect(status).toBe(2);
  });
});

describe("the PR lane refuses a migration it cannot verify", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");

  it("branches on the marker rather than on the exit code", () => {
    expect(ci).toContain("::probe-skipped-unconfigured::");
  });

  it("fails when a PR pairs a new migration with code, and the probe could not run", () => {
    // The shape #387 shipped: migration and the code reading it in one PR, on
    // an unverified push. That is what must be refused — not the migration on
    // its own, which is the correct order.
    expect(ci).toMatch(/supabase\/migrations\//);
    expect(ci).toMatch(/Migration and code in one PR, with no way to verify/);
  });

  it("does not block a PR with no migration in it", () => {
    // Blocking every PR on a check nobody has configured is what the frozen
    // test exists to prevent.
    expect(ci).toMatch(/Nothing here pairs a new migration with code that reads it/);
  });

  it("still says something when a migration lands alone", () => {
    // Passing silently would make "migration merged" and "columns on
    // production" look identical again, which is the whole defect.
    expect(ci).toMatch(/Migration added, not yet verified/);
  });

  it("does not refuse a migration landing on its OWN", () => {
    // A migration-only PR is the correct move, not the dangerous one:
    // "schema precedes code" means it lands first, is pushed, and is read back
    // off production BEFORE any code names the columns. The first version of
    // this guard refused exactly that — blocking the PR reinstating migration
    // 048 after its absence had already taken production down once. The
    // refusal needs a migration AND code that reads it.
    expect(ci).toMatch(/CODE_CHANGED/);
    expect(ci).toMatch(/ADDED_MIGRATIONS" \] && \[ -n "\$CODE_CHANGED/);
  });

  it("keys on migrations ADDED, never on the directory being touched", () => {
    // The first version asked whether the diff mentioned supabase/migrations/
    // at all, so it fired on a REVERT that removes a migration — refusing the
    // very PR that was restoring production after #387's columns turned out to
    // be missing. A PR deleting a migration asks production for nothing.
    expect(ci).toMatch(/--diff-filter=A/);
    expect(ci).toMatch(/ADDED_MIGRATIONS/);
  });
});

describe("the scheduled lane can fail loudly, because nothing waits on it", () => {
  const rls = readFileSync(".github/workflows/rls-check.yml", "utf8");

  it("runs the probe on the production-credentials schedule", () => {
    expect(rls).toContain("scripts/ci/schema-probe.ts");
  });

  it("fails when the secrets are absent, rather than skipping", () => {
    expect(rls).toMatch(/SUPABASE_READONLY_URL/);
    expect(rls).toMatch(/has never run/);
  });

  it("runs even if the RLS step above failed", () => {
    // Two independent facts about production. One being unknown must not make
    // the other unknown too.
    expect(rls).toMatch(/if:\s*always\(\)/);
  });
});
