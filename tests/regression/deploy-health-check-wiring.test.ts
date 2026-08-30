/**
 * The health check must never resolve its own deployment, and must never
 * promote one.
 *
 * Both halves have already gone wrong once each, and neither was visible from
 * the workflow's own logs.
 *
 * 1. Two separate triggers — `push: main`, then `workflow_run` — each let the
 *    workflow reach a lookup that asked for a *Preview* deployment on `main`.
 *    Vercel registers `main` against Production, so the query returned zero
 *    deployment objects and the poll reported `last status: none` every time.
 *    Removing the first trigger left the second doing the same thing, which is
 *    why this is pinned rather than commented.
 *
 * 2. `promote-to-production` ran `vercel alias set "$DEPLOYMENT_URL" motko.app`
 *    with no guard beyond `needs:`. Every URL this workflow can see belongs to
 *    an unmerged factory branch, so a green check would have aliased
 *    production to unreviewed code. It never ran, because of (1).
 *
 * See #462. Production is deployed by Vercel on merge to `main` (CLAUDE.md);
 * gating that needs a different deployment entirely and is its own item.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readRaw = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Comment lines are stripped before matching. The header of the health-check
 * workflow quotes the very code it removed — `vercel alias set … motko.app`,
 * `deployments?environment=Preview` — because a reader who does not know why
 * those are gone is a reader who puts them back. Matching raw source would
 * make recording the history indistinguishable from repeating it, and would
 * push the next author towards deleting the explanation to get green.
 */
const read = (p: string) =>
  readRaw(p)
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const HEALTH_CHECK = ".github/workflows/deploy-health-check.yml";
const DEPLOY = ".github/workflows/factory-deploy.yml";

describe("deploy-health-check is a smoke test, not a gate", () => {
  it("never promotes a deployment to the production alias", () => {
    const workflow = read(HEALTH_CHECK);
    expect(workflow).not.toMatch(/vercel\s+alias/);
    expect(workflow).not.toMatch(/promote-to-production/);
  });

  it("does not alias motko.app from any workflow", () => {
    // The job could be moved rather than deleted, which would read as a smaller
    // diff and be the same defect.
    for (const path of [HEALTH_CHECK, DEPLOY]) {
      expect(read(path), `${path} must not alias production`).not.toMatch(
        /alias\s+set/,
      );
    }
  });

  it("does not resolve a deployment from the main ref", () => {
    const workflow = read(HEALTH_CHECK);
    expect(workflow).not.toMatch(/git\/ref\/heads\/main/);
    expect(workflow).not.toMatch(/environment=Preview/);
  });

  it("is triggered only by workflow_dispatch", () => {
    const workflow = read(HEALTH_CHECK);
    // `workflow_run` and `push` both fed it a ref it could not use. A comment
    // naming them is fine; a trigger is not, so match the key at its indent.
    expect(workflow).not.toMatch(/^ {2}workflow_run:/m);
    expect(workflow).not.toMatch(/^ {2}push:/m);
    expect(workflow).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it("requires a deployment URL from its caller", () => {
    const workflow = read(HEALTH_CHECK);
    expect(workflow).toMatch(/deployment_url:[\s\S]*?required:\s*true/);
  });

  it("reports the URL it actually checked when it fails", () => {
    // The alert step read `inputs.deployment_url` on a path where that input
    // was empty, so the error line ended "failed for deployment " with nothing
    // after it. It must read the value the check ran against.
    const workflow = read(HEALTH_CHECK);
    const alert = workflow.slice(workflow.indexOf("Alert on health check failure"));
    expect(alert).toMatch(/DEPLOYMENT_URL:\s*\$\{\{\s*steps\.get_deployment\.outputs\.url\s*\}\}/);
  });
});

describe("the deploy workflow supplies the URL", () => {
  it("dispatches the health check with the preview URL it resolved", () => {
    const deploy = read(DEPLOY);
    expect(deploy).toMatch(/gh workflow run deploy-health-check\.yml/);
    expect(deploy).toMatch(/-f deployment_url="\$PREVIEW_URL"/);
  });

  it("cannot fail the deploy job", () => {
    // The announce comment is what a human waits on. A health check that can
    // block or redden it inverts the point of running it.
    const deploy = read(DEPLOY);
    const step = deploy.slice(deploy.indexOf("Smoke-test the preview"));
    expect(step.slice(0, step.indexOf("- name:", 1))).toMatch(
      /continue-on-error:\s*true/,
    );
  });

  it("announces the preview before smoke-testing it", () => {
    const deploy = read(DEPLOY);
    expect(deploy.indexOf("Announce, and flag if a migration")).toBeLessThan(
      deploy.indexOf("Smoke-test the preview"),
    );
  });
});
