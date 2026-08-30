import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Between 18 and 21 Aug 2026 the health check never once promoted: the "Get
// deployment URL" step polled for up to 10 minutes (40 x 15s) but the job was
// declared `timeout-minutes: 3`, so the runner killed it mid-wait every time.
// 30 consecutive push-to-main runs came back `cancelled`, and because a
// cancelled job is not a failed one, promote-to-production was skipped in
// silence rather than reporting an error.
//
// The bug was a mismatch between two numbers that have to agree and live 40
// lines apart, which is exactly the kind of thing review does not catch.
//
// #462 then removed the cause rather than the symptom: the workflow no longer
// looks a deployment up at all, so there is no loop and no pair of numbers to
// disagree. The caller supplies the URL. The loop assertions below are
// therefore CONDITIONAL — they say nothing while no loop exists, and bind
// again the moment someone adds one back. That is deliberate: a lookup is what
// the timeout bug grew out of, and the next author to add one should inherit
// the constraint rather than rediscover it.

const WORKFLOW = readFileSync(
  join(process.cwd(), ".github", "workflows", "deploy-health-check.yml"),
  "utf8",
);

// `timeout-minutes` on the health-check job — the first one in the file, which
// belongs to the job that would own any wait loop.
const jobTimeoutMinutes = (): number => {
  const match = WORKFLOW.match(/^\s*timeout-minutes:\s*(\d+)/m);
  if (!match) throw new Error("no timeout-minutes found on the health-check job");
  return Number(match[1]);
};

// The wait loop's own budget: `seq 1 N` iterations x `sleep S` seconds.
// Null when there is no loop, which is the shape since #462.
const loopBudgetMinutes = (): number | null => {
  const iterations = WORKFLOW.match(/for i in \$\(seq 1 (\d+)\); do/);
  const sleepSeconds = WORKFLOW.match(/^\s*sleep (\d+)$/m);
  if (!iterations || !sleepSeconds) return null;
  return (Number(iterations[1]) * Number(sleepSeconds[1])) / 60;
};

describe("deploy health check — the job outlives its own wait loop", () => {
  it("gives the job more time than any deployment wait can consume", () => {
    const loop = loopBudgetMinutes();
    if (loop === null) return; // No lookup since #462 — nothing to outlive.

    // Strictly greater: equal would still be killed, since checkout and the
    // API calls inside each iteration cost real time on top of the sleeps.
    expect(jobTimeoutMinutes()).toBeGreaterThan(loop);
  });

  it("leaves headroom for checkout and API latency, not just the sleeps", () => {
    const loop = loopBudgetMinutes();
    if (loop === null) return;

    // Each iteration also makes several `gh api` calls, so wall clock runs
    // ahead of iterations x sleep. A minute of slack is the minimum that makes
    // the loop able to actually reach its own timeout.
    expect(jobTimeoutMinutes() - loop).toBeGreaterThanOrEqual(1);
  });

  it("is not triggered by an event that carries no preview to check", () => {
    // Preview deployments come from "Factory — Deploy to Preview", which
    // triggers on an issue label and resolves `heads/factory/<issue>`. Neither
    // a push to main nor a `workflow_run` on main carries any way to reach one
    // — both were tried, and both spent their whole budget on a query that
    // matched nothing (`last status: none` on every poll, i.e. no deployment
    // object at all rather than one still building).
    //
    // `workflow_dispatch` is the only trigger that can supply a real preview,
    // because the caller passes it in. See #462.
    // Strip comments first: the workflow explains at length why the other
    // triggers are gone, and a negative assertion that reads prose would fire
    // on the explanation.
    const yamlOnly = WORKFLOW.split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
    const onBlock = yamlOnly.split(/^jobs:/m)[0];

    expect(onBlock).not.toMatch(/^\s{2}push:/m);
    expect(yamlOnly).not.toMatch(/github\.event_name == 'push'/);
    expect(onBlock).not.toMatch(/^\s{2}workflow_run:/m);

    // The one path that can work must survive.
    expect(onBlock).toMatch(/^\s{2}workflow_dispatch:/m);
  });

  it("still fails the job rather than passing when no deployment appears", () => {
    // The original failure was silence: a cancelled job is not a failed one,
    // so a missing deployment skipped the next job without going red. Under
    // the current shape the equivalent is an empty `deployment_url` — the
    // caller resolved nothing — and it must be just as loud. It reached the
    // failure alert once already, which is why the error line read "failed for
    // deployment " with a blank after it.
    expect(WORKFLOW).toMatch(/No deployment_url was supplied/);
    expect(WORKFLOW).toMatch(/exit 1/);
  });
});
