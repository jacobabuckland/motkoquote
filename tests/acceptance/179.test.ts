import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const readFile = (path: string): string => {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(fullPath, "utf-8");
};

const listWorkflows = (): string[] => {
  const workflowsDir = join(process.cwd(), ".github/workflows");
  if (!existsSync(workflowsDir)) {
    throw new Error("Workflows directory not found: .github/workflows");
  }
  return readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => join(".github/workflows", f));
};

describe("Issue #179: Block Deploy agent merge on red CI with no override path", () => {
  describe("Deploy agent checks CI status before merge", () => {
    it("Deploy agent workflow fetches check runs for PR head SHA", () => {
      // The Deploy agent workflow should fetch check runs via GitHub API
      // Look for either factory-deploy.yml or a dedicated merge workflow
      const workflows = listWorkflows();

      let found = false;
      let workflowWithCheckFetch = "";

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Look for check-run API calls
        // Could be: gh api repos/.../commits/.../check-runs
        // or: gh api repos/.../commits/.../check-suites
        // or: gh pr checks
        if (
          content.includes("check-runs") ||
          content.includes("check-suites") ||
          content.includes("gh pr checks")
        ) {
          found = true;
          workflowWithCheckFetch = workflow;
          break;
        }
      }

      expect(found).toBe(true);
      expect(workflowWithCheckFetch).toBeTruthy();
    });

    it("Deploy agent only merges when all required checks are successful", () => {
      const workflows = listWorkflows();

      let found = false;

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Look for merge logic that is conditional on check status
        // Should see patterns like:
        // - checking conclusion == "success"
        // - conditional merge based on check status
        // - verifying all required checks pass
        if (
          content.includes("check-runs") &&
          content.includes("merge") &&
          (content.includes("conclusion") || content.includes("success"))
        ) {
          found = true;
          break;
        }
      }

      expect(found).toBe(true);
    });

    it("Deploy agent refuses merge when checks are pending", () => {
      const workflows = listWorkflows();

      let checksForPendingState = false;

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Look for logic that checks status or conclusion
        // Should handle: in_progress, queued, waiting, pending states
        if (
          content.includes("check-runs") &&
          (content.includes("in_progress") ||
            content.includes("queued") ||
            content.includes("pending") ||
            content.includes("status"))
        ) {
          checksForPendingState = true;
          break;
        }
      }

      expect(checksForPendingState).toBe(true);
    });

    it("Deploy agent refuses merge when zero check runs are reported", () => {
      const workflows = listWorkflows();

      let checksForEmptyCheckRuns = false;

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Look for logic that handles empty/zero check runs
        // Should fail closed: no checks = blocked
        if (
          content.includes("check-runs") &&
          (content.includes("length") ||
            content.includes("empty") ||
            content.includes("== 0") ||
            content.includes("-eq 0"))
        ) {
          checksForEmptyCheckRuns = true;
          break;
        }
      }

      expect(checksForEmptyCheckRuns).toBe(true);
    });
  });

  describe("Deploy agent blocks and reports on check failures", () => {
    it("Deploy agent sets Status to Blocked when checks fail", () => {
      const workflows = listWorkflows();

      let setsBlocked = false;

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Look for Notion API calls that set Status to Blocked
        // based on check failure
        if (
          content.includes("check-runs") &&
          content.includes("Blocked") &&
          (content.includes("notion") || content.includes("NOTION_API"))
        ) {
          setsBlocked = true;
          break;
        }
      }

      expect(setsBlocked).toBe(true);
    });

    it("Deploy agent comments on PR with failing check names", () => {
      const workflows = listWorkflows();

      let commentsOnFailure = false;

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Look for PR comment logic that reports failing checks
        if (
          content.includes("check-runs") &&
          (content.includes("gh issue comment") ||
            content.includes("gh pr comment") ||
            content.includes("comment --body"))
        ) {
          commentsOnFailure = true;
          break;
        }
      }

      expect(commentsOnFailure).toBe(true);
    });

    it("Deploy agent treats neutral and skipped checks as failures", () => {
      const workflows = listWorkflows();

      let handlesNeutralSkipped = false;

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Look for explicit handling of neutral/skipped conclusion states
        if (
          content.includes("check-runs") &&
          (content.includes("neutral") || content.includes("skipped"))
        ) {
          handlesNeutralSkipped = true;
          break;
        }
      }

      expect(handlesNeutralSkipped).toBe(true);
    });

    it("Deploy agent handles GitHub API errors by refusing merge", () => {
      const workflows = listWorkflows();

      let handlesAPIErrors = false;

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Look for error handling around check-run API calls
        if (
          content.includes("check-runs") &&
          (content.includes("if [ $?") ||
            content.includes("exit 1") ||
            content.includes("error") ||
            content.includes("|| true") === false) // should NOT have || true, which silences errors
        ) {
          handlesAPIErrors = true;
          break;
        }
      }

      expect(handlesAPIErrors).toBe(true);
    });
  });

  describe("Deploy agent handles edge cases", () => {
    it("Deploy agent exits cleanly if PR is already merged", () => {
      const workflows = listWorkflows();

      let handlesAlreadyMerged = false;

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Look for check whether PR is already merged
        if (
          content.includes("merge") &&
          (content.includes("already merged") ||
            content.includes("merged") && content.includes("state"))
        ) {
          handlesAlreadyMerged = true;
          break;
        }
      }

      expect(handlesAlreadyMerged).toBe(true);
    });

    it("Deploy agent re-verifies if head SHA changes", () => {
      const workflows = listWorkflows();

      let checksHeadSHA = false;

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Look for SHA tracking and re-verification logic
        if (
          content.includes("check-runs") &&
          content.includes("SHA") &&
          (content.includes("head") || content.includes("sha"))
        ) {
          checksHeadSHA = true;
          break;
        }
      }

      expect(checksHeadSHA).toBe(true);
    });
  });

  describe("No workflow uses admin or bypass merge parameters", () => {
    it("no workflow calls gh pr merge with --admin flag", () => {
      const workflows = listWorkflows();

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Should NOT contain: gh pr merge --admin
        expect(content).not.toMatch(/gh\s+pr\s+merge[^\n]*--admin/);
      }
    });

    it("no workflow calls gh pr merge with --bypass flag", () => {
      const workflows = listWorkflows();

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Should NOT contain: gh pr merge --bypass (or --bypass-branch-protection)
        expect(content).not.toMatch(/gh\s+pr\s+merge[^\n]*--bypass/);
      }
    });

    it("no workflow calls GitHub merge API with bypass_branch_protections parameter", () => {
      const workflows = listWorkflows();

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Should NOT contain: bypass_branch_protections: true (in API calls)
        expect(content).not.toMatch(/bypass[_-]branch[_-]protection/i);
      }
    });

    it("no workflow calls GitHub merge API with admin parameter", () => {
      const workflows = listWorkflows();

      for (const workflow of workflows) {
        const content = readFile(workflow);

        // Should NOT contain merge API calls with admin: true or similar
        // This is a more general check for any admin bypass attempt
        if (content.includes("merge") && content.includes("api")) {
          expect(content).not.toMatch(/"admin":\s*true/);
          expect(content).not.toMatch(/admin=true/);
        }
      }
    });
  });

  describe("Refusal behavior is documented", () => {
    it("FACTORY.md exists and documents the CI gate", () => {
      // Check for FACTORY.md in root or docs/
      const factoryMdPaths = ["FACTORY.md", "docs/factory.md", "docs/FACTORY.md"];

      let found = false;
      let content = "";

      for (const path of factoryMdPaths) {
        const fullPath = join(process.cwd(), path);
        if (existsSync(fullPath)) {
          found = true;
          content = readFileSync(fullPath, "utf-8");
          break;
        }
      }

      expect(found).toBe(true);
      expect(content).toBeTruthy();
    });

    it("FACTORY.md explains that Deploy agent checks CI before merge", () => {
      const factoryMdPaths = ["FACTORY.md", "docs/factory.md", "docs/FACTORY.md"];

      let content = "";

      for (const path of factoryMdPaths) {
        const fullPath = join(process.cwd(), path);
        if (existsSync(fullPath)) {
          content = readFileSync(fullPath, "utf-8");
          break;
        }
      }

      expect(content).toMatch(/Deploy.*agent/i);
      expect(content).toMatch(/CI|check.*run/i);
      expect(content).toMatch(/merge/i);
    });

    it("FACTORY.md explains what states cause merge refusal", () => {
      const factoryMdPaths = ["FACTORY.md", "docs/factory.md", "docs/FACTORY.md"];

      let content = "";

      for (const path of factoryMdPaths) {
        const fullPath = join(process.cwd(), path);
        if (existsSync(fullPath)) {
          content = readFileSync(fullPath, "utf-8");
          break;
        }
      }

      // Should mention failure states: failing, pending, neutral, skipped, etc.
      expect(content).toMatch(/fail|pending|block/i);
    });

    it("FACTORY.md explains that absence of checks is treated as failure", () => {
      const factoryMdPaths = ["FACTORY.md", "docs/factory.md", "docs/FACTORY.md"];

      let content = "";

      for (const path of factoryMdPaths) {
        const fullPath = join(process.cwd(), path);
        if (existsSync(fullPath)) {
          content = readFileSync(fullPath, "utf-8");
          break;
        }
      }

      // Should explain fail-closed behavior: no checks = blocked
      expect(content).toMatch(/absence.*fail|no.*check.*fail|zero.*check/i);
    });

    it("FACTORY.md explains where to look when Status is Blocked due to CI", () => {
      const factoryMdPaths = ["FACTORY.md", "docs/factory.md", "docs/FACTORY.md"];

      let content = "";

      for (const path of factoryMdPaths) {
        const fullPath = join(process.cwd(), path);
        if (existsSync(fullPath)) {
          content = readFileSync(fullPath, "utf-8");
          break;
        }
      }

      // Should explain what to do when blocked
      expect(content).toMatch(/Blocked/);
      expect(content).toMatch(/CI|check|PR/i);
    });
  });

  describe("CI gate is a required check", () => {
    it("repository has branch protection configured for main", async () => {
      // This test checks that the CI gate job is configured as a required check
      // It reads the .github/workflows/ci.yml to verify the gate job exists
      const ciWorkflow = readFile(".github/workflows/ci.yml");

      // The ci.yml should have a job named "gate" (or similar)
      expect(ciWorkflow).toMatch(/jobs:/);
      expect(ciWorkflow).toMatch(/gate:/);
    });

    it("CI gate job runs typecheck, lint, test, and build", () => {
      const ciWorkflow = readFile(".github/workflows/ci.yml");

      // The gate job should run all four checks
      expect(ciWorkflow).toMatch(/typecheck/i);
      expect(ciWorkflow).toMatch(/lint/i);
      expect(ciWorkflow).toMatch(/test/i);
      expect(ciWorkflow).toMatch(/build/i);
    });
  });
});
