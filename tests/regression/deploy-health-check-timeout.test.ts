import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The deploy health check gates promotion to production. Between 18 and 21 Aug
// 2026 it never once promoted: the "Get deployment URL" step polls for up to
// 10 minutes (40 x 15s) but the job was declared `timeout-minutes: 3`, so the
// runner killed it mid-wait every time. 30 consecutive push-to-main runs came
// back `cancelled`, and because a cancelled job is not a failed one,
// promote-to-production was skipped in silence rather than reporting an error.
//
// The bug is a mismatch between two numbers that have to agree and live 40
// lines apart, which is exactly the kind of thing review does not catch. This
// derives both from the file and asserts the relationship.

const WORKFLOW = readFileSync(
  join(process.cwd(), ".github", "workflows", "deploy-health-check.yml"),
  "utf8",
);

// `timeout-minutes` on the health-check job — the first one in the file, which
// belongs to the job that owns the wait loop.
const jobTimeoutMinutes = (): number => {
  const match = WORKFLOW.match(/^\s*timeout-minutes:\s*(\d+)/m);
  if (!match) throw new Error("no timeout-minutes found on the health-check job");
  return Number(match[1]);
};

// The wait loop's own budget: `seq 1 N` iterations x `sleep S` seconds.
const loopBudgetMinutes = (): number => {
  const iterations = WORKFLOW.match(/for i in \$\(seq 1 (\d+)\); do/);
  const sleepSeconds = WORKFLOW.match(/^\s*sleep (\d+)$/m);
  if (!iterations || !sleepSeconds) {
    throw new Error("could not read the deployment wait loop's iteration count or sleep");
  }
  return (Number(iterations[1]) * Number(sleepSeconds[1])) / 60;
};

describe("deploy health check — the job outlives its own wait loop", () => {
  it("gives the job more time than the deployment wait can consume", () => {
    const timeout = jobTimeoutMinutes();
    const loop = loopBudgetMinutes();

    // Strictly greater: equal would still be killed, since checkout and the
    // API calls inside each iteration cost real time on top of the sleeps.
    expect(timeout).toBeGreaterThan(loop);
  });

  it("leaves headroom for checkout and API latency, not just the sleeps", () => {
    // Each iteration also makes several `gh api` calls, so wall clock runs
    // ahead of iterations x sleep. A minute of slack is the minimum that makes
    // the loop able to actually reach its own timeout.
    expect(jobTimeoutMinutes() - loopBudgetMinutes()).toBeGreaterThanOrEqual(1);
  });

  it("still fails the job rather than passing when no deployment appears", () => {
    // The point of raising the timeout is that the loop reaches its own exit
    // and reports a real error. If this `exit 1` ever goes, a missing
    // deployment would silently skip promotion again instead of going red.
    expect(WORKFLOW).toMatch(/No successful preview deployment/);
    expect(WORKFLOW).toMatch(/exit 1/);
  });
});
