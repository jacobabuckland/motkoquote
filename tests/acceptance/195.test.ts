import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const readFile = (path: string): string => {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(fullPath, "utf-8");
};

describe("Issue #195: Add a post-deploy health check gating promotion to production", () => {
  describe("Health check workflow exists", () => {
    it("has a GitHub Actions workflow file for deploy health check", () => {
      // The workflow can be in .github/workflows/ with any reasonable name
      const possiblePaths = [
        ".github/workflows/deploy-health-check.yml",
        ".github/workflows/health-check.yml",
        ".github/workflows/post-deploy-health-check.yml",
      ];

      const workflowExists = possiblePaths.some((path) =>
        existsSync(join(process.cwd(), path))
      );

      expect(workflowExists).toBe(true);
    });

    it("workflow runs on deployment events", () => {
      const possiblePaths = [
        ".github/workflows/deploy-health-check.yml",
        ".github/workflows/health-check.yml",
        ".github/workflows/post-deploy-health-check.yml",
      ];

      const workflowPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!workflowPath) {
        throw new Error("No health check workflow found");
      }

      const workflow = readFile(workflowPath);

      // Should trigger on deployment_status or after preview deployment
      // Could also be integrated into the existing deploy workflow
      const hasDeploymentTrigger =
        workflow.includes("deployment_status") ||
        workflow.includes("workflow_run") ||
        workflow.includes("workflow_call") ||
        workflow.includes("on:") ||
        workflow.includes("workflow_dispatch");

      expect(hasDeploymentTrigger).toBe(true);
    });

    it("workflow has concurrency control to serialize deployments", () => {
      const possiblePaths = [
        ".github/workflows/deploy-health-check.yml",
        ".github/workflows/health-check.yml",
        ".github/workflows/post-deploy-health-check.yml",
      ];

      const workflowPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!workflowPath) {
        throw new Error("No health check workflow found");
      }

      const workflow = readFile(workflowPath);

      // Should have concurrency group to prevent concurrent promotions
      expect(workflow).toMatch(/concurrency:/);
      expect(workflow).toMatch(/cancel-in-progress:\s*false/);
    });

    it("workflow fails the job if health check fails", () => {
      const possiblePaths = [
        ".github/workflows/deploy-health-check.yml",
        ".github/workflows/health-check.yml",
        ".github/workflows/post-deploy-health-check.yml",
      ];

      const workflowPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!workflowPath) {
        throw new Error("No health check workflow found");
      }

      const workflow = readFile(workflowPath);

      // Should exit with error if health check fails (prevents promotion)
      const hasFailureHandling =
        workflow.includes("exit 1") || workflow.includes("if:") || workflow.includes("failure()");

      expect(hasFailureHandling).toBe(true);
    });
  });

  describe("Critical paths configuration file exists", () => {
    it("has a configuration file defining critical paths", () => {
      const possiblePaths = [
        "deploy-health-check.json",
        ".github/deploy-health-check.json",
        ".github/health-check-paths.json",
        "health-check.json",
      ];

      const configExists = possiblePaths.some((path) =>
        existsSync(join(process.cwd(), path))
      );

      expect(configExists).toBe(true);
    });

    it("configuration is valid JSON", () => {
      const possiblePaths = [
        "deploy-health-check.json",
        ".github/deploy-health-check.json",
        ".github/health-check-paths.json",
        "health-check.json",
      ];

      const configPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!configPath) {
        throw new Error("No health check configuration found");
      }

      const configContent = readFile(configPath);
      const parsed = JSON.parse(configContent) as Record<string, unknown>;

      expect(parsed).toBeDefined();
    });

    it("includes dashboard path as a critical path", () => {
      const possiblePaths = [
        "deploy-health-check.json",
        ".github/deploy-health-check.json",
        ".github/health-check-paths.json",
        "health-check.json",
      ];

      const configPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!configPath) {
        throw new Error("No health check configuration found");
      }

      const configContent = readFile(configPath);
      const parsed = JSON.parse(configContent) as {
        paths?: Array<{ path?: string; requiresAuth?: boolean }>;
        criticalPaths?: Array<{ path?: string; requiresAuth?: boolean }>;
      };

      const paths = parsed.paths ?? parsed.criticalPaths ?? [];

      // Should include the dashboard (authenticated page)
      const hasDashboard = paths.some(
        (p) =>
          (p.path === "/" || p.path === "/dashboard" || p.path?.includes("dashboard")) &&
          p.requiresAuth === true
      );

      expect(hasDashboard).toBe(true);
    });

    it("includes customer quote page as a critical path", () => {
      const possiblePaths = [
        "deploy-health-check.json",
        ".github/deploy-health-check.json",
        ".github/health-check-paths.json",
        "health-check.json",
      ];

      const configPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!configPath) {
        throw new Error("No health check configuration found");
      }

      const configContent = readFile(configPath);
      const parsed = JSON.parse(configContent) as {
        paths?: Array<{ path?: string }>;
        criticalPaths?: Array<{ path?: string }>;
      };

      const paths = parsed.paths ?? parsed.criticalPaths ?? [];

      // Should include a customer-facing quote page (public, no auth)
      // The path pattern might be /q/* or similar
      const hasQuotePage = paths.some((p) => p.path?.includes("/q/") || p.path?.includes("quote"));

      expect(hasQuotePage).toBe(true);
    });

    it("includes TrueLayer webhook endpoint as a critical path", () => {
      const possiblePaths = [
        "deploy-health-check.json",
        ".github/deploy-health-check.json",
        ".github/health-check-paths.json",
        "health-check.json",
      ];

      const configPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!configPath) {
        throw new Error("No health check configuration found");
      }

      const configContent = readFile(configPath);
      const parsed = JSON.parse(configContent) as {
        paths?: Array<{ path?: string }>;
        criticalPaths?: Array<{ path?: string }>;
      };

      const paths = parsed.paths ?? parsed.criticalPaths ?? [];

      // Should include the TrueLayer webhook
      const hasWebhook = paths.some(
        (p) => p.path === "/api/truelayer/webhook" || p.path?.includes("truelayer/webhook")
      );

      expect(hasWebhook).toBe(true);
    });

    it("marks authenticated paths correctly", () => {
      const possiblePaths = [
        "deploy-health-check.json",
        ".github/deploy-health-check.json",
        ".github/health-check-paths.json",
        "health-check.json",
      ];

      const configPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!configPath) {
        throw new Error("No health check configuration found");
      }

      const configContent = readFile(configPath);
      const parsed = JSON.parse(configContent) as {
        paths?: Array<{ path?: string; requiresAuth?: boolean; authenticated?: boolean }>;
        criticalPaths?: Array<{ path?: string; requiresAuth?: boolean; authenticated?: boolean }>;
      };

      const paths = parsed.paths ?? parsed.criticalPaths ?? [];

      // Each path should have an auth indicator (requiresAuth, authenticated, or similar)
      const allHaveAuthIndicator = paths.every(
        (p) =>
          p.requiresAuth !== undefined ||
          p.authenticated !== undefined ||
          typeof p === "string" // Simple string paths might be public by default
      );

      expect(allHaveAuthIndicator).toBe(true);
    });
  });

  describe("Health check script exists", () => {
    it("has a health check script file", () => {
      const possiblePaths = [
        ".github/scripts/health-check.sh",
        ".github/scripts/health-check.js",
        ".github/scripts/health-check.ts",
        "scripts/health-check.sh",
        "scripts/health-check.js",
      ];

      const scriptExists = possiblePaths.some((path) =>
        existsSync(join(process.cwd(), path))
      );

      expect(scriptExists).toBe(true);
    });

    it("script reads the configuration file", () => {
      const possiblePaths = [
        ".github/scripts/health-check.sh",
        ".github/scripts/health-check.js",
        ".github/scripts/health-check.ts",
        "scripts/health-check.sh",
        "scripts/health-check.js",
      ];

      const scriptPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!scriptPath) {
        throw new Error("No health check script found");
      }

      const script = readFile(scriptPath);

      // Should read the configuration file (JSON or similar)
      const readsConfig =
        script.includes("deploy-health-check.json") ||
        script.includes("health-check") ||
        script.includes("JSON.parse") ||
        script.includes("jq") ||
        script.includes("cat");

      expect(readsConfig).toBe(true);
    });

    it("script accepts deployment URL as parameter or environment variable", () => {
      const possiblePaths = [
        ".github/scripts/health-check.sh",
        ".github/scripts/health-check.js",
        ".github/scripts/health-check.ts",
        "scripts/health-check.sh",
        "scripts/health-check.js",
      ];

      const scriptPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!scriptPath) {
        throw new Error("No health check script found");
      }

      const script = readFile(scriptPath);

      // Should take URL as $1, $DEPLOYMENT_URL, or similar
      const acceptsUrl =
        script.includes("$1") ||
        script.includes("DEPLOYMENT_URL") ||
        script.includes("PREVIEW_URL") ||
        script.includes("process.env") ||
        script.includes("process.argv");

      expect(acceptsUrl).toBe(true);
    });

    it("script makes HTTP requests to verify paths", () => {
      const possiblePaths = [
        ".github/scripts/health-check.sh",
        ".github/scripts/health-check.js",
        ".github/scripts/health-check.ts",
        "scripts/health-check.sh",
        "scripts/health-check.js",
      ];

      const scriptPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!scriptPath) {
        throw new Error("No health check script found");
      }

      const script = readFile(scriptPath);

      // Should use curl, fetch, or similar to make requests
      const makesRequests =
        script.includes("curl") ||
        script.includes("fetch") ||
        script.includes("axios") ||
        script.includes("http.get") ||
        script.includes("https.get");

      expect(makesRequests).toBe(true);
    });

    it("script implements warm-up requests before actual checks", () => {
      const possiblePaths = [
        ".github/scripts/health-check.sh",
        ".github/scripts/health-check.js",
        ".github/scripts/health-check.ts",
        "scripts/health-check.sh",
        "scripts/health-check.js",
      ];

      const scriptPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!scriptPath) {
        throw new Error("No health check script found");
      }

      const script = readFile(scriptPath);

      // Should mention warm-up, cold start, or make initial requests that are not counted
      const hasWarmup =
        script.includes("warm") ||
        script.includes("cold") ||
        script.includes("initial") ||
        script.includes("sleep") ||
        script.includes("wait");

      expect(hasWarmup).toBe(true);
    });

    it("script handles authentication for protected paths", () => {
      const possiblePaths = [
        ".github/scripts/health-check.sh",
        ".github/scripts/health-check.js",
        ".github/scripts/health-check.ts",
        "scripts/health-check.sh",
        "scripts/health-check.js",
      ];

      const scriptPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!scriptPath) {
        throw new Error("No health check script found");
      }

      const script = readFile(scriptPath);

      // Should use authentication (cookies, tokens, secrets)
      const handlesAuth =
        script.includes("auth") ||
        script.includes("cookie") ||
        script.includes("token") ||
        script.includes("session") ||
        script.includes("secrets.") ||
        script.includes("${{");

      expect(handlesAuth).toBe(true);
    });

    it("script exits with non-zero code on failure", () => {
      const possiblePaths = [
        ".github/scripts/health-check.sh",
        ".github/scripts/health-check.js",
        ".github/scripts/health-check.ts",
        "scripts/health-check.sh",
        "scripts/health-check.js",
      ];

      const scriptPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!scriptPath) {
        throw new Error("No health check script found");
      }

      const script = readFile(scriptPath);

      // Should exit 1 or process.exit(1) on failure
      const exitsOnFailure =
        script.includes("exit 1") ||
        script.includes("process.exit(1)") ||
        script.includes("throw new Error");

      expect(exitsOnFailure).toBe(true);
    });
  });

  describe("FACTORY.md documentation exists", () => {
    it("has a FACTORY.md file in the repository root", () => {
      const factoryMdPath = join(process.cwd(), "FACTORY.md");
      expect(existsSync(factoryMdPath)).toBe(true);
    });

    it("documents the rollback procedure", () => {
      const factoryMd = readFile("FACTORY.md");

      // Should mention rollback
      expect(factoryMd.toLowerCase()).toMatch(/rollback/);
    });

    it("documents how to promote a previous deployment manually", () => {
      const factoryMd = readFile("FACTORY.md");

      // Should mention manual promotion or Vercel alias management
      const hasManualPromotion =
        factoryMd.includes("promote") ||
        factoryMd.includes("alias") ||
        factoryMd.includes("vercel") ||
        factoryMd.includes("previous deployment");

      expect(hasManualPromotion).toBe(true);
    });

    it("documents the manual override procedure for failing health checks", () => {
      const factoryMd = readFile("FACTORY.md");

      // Should mention override or bypass
      const hasOverride =
        factoryMd.toLowerCase().includes("override") ||
        factoryMd.toLowerCase().includes("bypass") ||
        factoryMd.toLowerCase().includes("emergency");

      expect(hasOverride).toBe(true);
    });

    it("documents the warm-up behaviour for cold starts", () => {
      const factoryMd = readFile("FACTORY.md");

      // Should mention warm-up or cold start
      const hasWarmupDocs =
        factoryMd.toLowerCase().includes("warm") || factoryMd.toLowerCase().includes("cold");

      expect(hasWarmupDocs).toBe(true);
    });

    it("states that override must be explicit and logged", () => {
      const factoryMd = readFile("FACTORY.md");

      // Should mention logging or explicit action
      const hasExplicitRequirement =
        factoryMd.toLowerCase().includes("explicit") ||
        factoryMd.toLowerCase().includes("log") ||
        factoryMd.toLowerCase().includes("manual");

      expect(hasExplicitRequirement).toBe(true);
    });
  });

  describe("Workflow integration and promotion gating", () => {
    it("workflow prevents promotion when health check fails", () => {
      const possiblePaths = [
        ".github/workflows/deploy-health-check.yml",
        ".github/workflows/health-check.yml",
        ".github/workflows/post-deploy-health-check.yml",
      ];

      const workflowPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!workflowPath) {
        throw new Error("No health check workflow found");
      }

      const workflow = readFile(workflowPath);

      // The promotion step should be conditional on health check success
      // Or the workflow should fail before promotion happens
      const preventsPromotion =
        workflow.includes("if:") ||
        workflow.includes("needs:") ||
        workflow.includes("failure()") ||
        workflow.includes("exit 1");

      expect(preventsPromotion).toBe(true);
    });

    it("workflow raises an alert on health check failure", () => {
      const possiblePaths = [
        ".github/workflows/deploy-health-check.yml",
        ".github/workflows/health-check.yml",
        ".github/workflows/post-deploy-health-check.yml",
      ];

      const workflowPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!workflowPath) {
        throw new Error("No health check workflow found");
      }

      const workflow = readFile(workflowPath);

      // Should comment on issue, send notification, or similar
      const raisesAlert =
        workflow.includes("gh issue comment") ||
        workflow.includes("gh pr comment") ||
        workflow.includes("notification") ||
        workflow.includes("slack") ||
        workflow.includes("::error::");

      expect(raisesAlert).toBe(true);
    });

    it("workflow completes within 3 minutes", () => {
      const possiblePaths = [
        ".github/workflows/deploy-health-check.yml",
        ".github/workflows/health-check.yml",
        ".github/workflows/post-deploy-health-check.yml",
      ];

      const workflowPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!workflowPath) {
        throw new Error("No health check workflow found");
      }

      const workflow = readFile(workflowPath);

      // Should have a timeout of 3 minutes or less (180 seconds)
      // timeout-minutes: 3 or timeout: 180 or similar
      const hasTimeout = workflow.includes("timeout");

      expect(hasTimeout).toBe(true);

      if (workflow.includes("timeout-minutes:")) {
        const timeoutMatch = workflow.match(/timeout-minutes:\s*(\d+)/);
        if (timeoutMatch) {
          const timeoutMinutes = parseInt(timeoutMatch[1]!, 10);
          expect(timeoutMinutes).toBeLessThanOrEqual(3);
        }
      }
    });
  });

  describe("Test account and secrets", () => {
    it("documents which secrets are required for the health check", () => {
      const factoryMd = readFile("FACTORY.md");

      // Should mention secret names or credentials
      const mentionsSecrets =
        factoryMd.toLowerCase().includes("secret") ||
        factoryMd.toLowerCase().includes("credential") ||
        factoryMd.toLowerCase().includes("test account");

      expect(mentionsSecrets).toBe(true);
    });

    it("workflow references test account credentials from secrets", () => {
      const possiblePaths = [
        ".github/workflows/deploy-health-check.yml",
        ".github/workflows/health-check.yml",
        ".github/workflows/post-deploy-health-check.yml",
      ];

      const workflowPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!workflowPath) {
        throw new Error("No health check workflow found");
      }

      const workflow = readFile(workflowPath);

      // Should reference secrets.SOMETHING
      const usesSecrets = workflow.includes("secrets.") || workflow.includes("${{ secrets");

      expect(usesSecrets).toBe(true);
    });
  });

  describe("Fail-closed behaviour", () => {
    it("script treats check errors as failures (not passes)", () => {
      const possiblePaths = [
        ".github/scripts/health-check.sh",
        ".github/scripts/health-check.js",
        ".github/scripts/health-check.ts",
        "scripts/health-check.sh",
        "scripts/health-check.js",
      ];

      const scriptPath = possiblePaths.find((path) =>
        existsSync(join(process.cwd(), path))
      );

      if (!scriptPath) {
        throw new Error("No health check script found");
      }

      const script = readFile(scriptPath);

      // Should exit 1 on error, not exit 0
      // Fail closed: if unsure, fail the check
      const failsClosed =
        script.includes("exit 1") ||
        script.includes("process.exit(1)") ||
        (script.includes("catch") && script.includes("exit"));

      expect(failsClosed).toBe(true);
    });
  });
});
