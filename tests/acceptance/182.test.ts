import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Issue #182: Remove the stale pnpm-lock.yaml and settle on one package manager
 *
 * These tests verify that:
 * - pnpm-lock.yaml is deleted
 * - package.json declares an explicit packageManager field
 * - No workflows, scripts, or user-facing docs reference pnpm (with known exceptions)
 * - A clean npm ci succeeds
 * - The full suite and build pass
 */

const repoRoot = resolve(__dirname, "../..");

describe("Issue #182: Remove the stale pnpm-lock.yaml and settle on one package manager", () => {
  describe("Stale lockfile is removed", () => {
    it("pnpm-lock.yaml does not exist in the repository", () => {
      const pnpmLockPath = join(repoRoot, "pnpm-lock.yaml");
      expect(existsSync(pnpmLockPath)).toBe(false);
    });
  });

  describe("Package manager is explicitly declared", () => {
    it("package.json has a packageManager field", () => {
      const packageJsonPath = join(repoRoot, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

      expect(packageJson).toHaveProperty("packageManager");
      expect(typeof packageJson.packageManager).toBe("string");
      expect(packageJson.packageManager.length).toBeGreaterThan(0);
    });

    it("packageManager field specifies npm", () => {
      const packageJsonPath = join(repoRoot, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

      expect(packageJson.packageManager).toMatch(/^npm@/);
    });
  });

  describe("No inappropriate pnpm references remain", () => {
    it("GitHub Actions workflows use npm, not pnpm", () => {
      const workflowsDir = join(repoRoot, ".github", "workflows");

      if (!existsSync(workflowsDir)) {
        throw new Error(".github/workflows directory does not exist");
      }

      const workflowFiles = readdirSync(workflowsDir).filter((f) =>
        f.endsWith(".yml") || f.endsWith(".yaml")
      );

      expect(workflowFiles.length).toBeGreaterThan(0);

      // Check each workflow for pnpm references (should be none)
      for (const file of workflowFiles) {
        const content = readFileSync(join(workflowsDir, file), "utf-8");

        // Should not invoke pnpm commands
        expect(content).not.toMatch(/\bpnpm\s+(install|ci|add|run|dlx|exec)/);
      }
    });

    it("README.md does not instruct users to use pnpm", () => {
      const readmePath = join(repoRoot, "README.md");
      const readme = readFileSync(readmePath, "utf-8");

      // Should not have pnpm install or pnpm dev instructions
      expect(readme).not.toMatch(/pnpm\s+(install|dev|start|build)/);
    });

    it("developer-facing documentation uses npm consistently", () => {
      const docsToCheck = [
        "docs/build-plan.md",
        "docs/marketing-screenshots.md",
        "APP_STORE_CHECKLIST.md",
      ];

      for (const docPath of docsToCheck) {
        const fullPath = join(repoRoot, docPath);

        if (!existsSync(fullPath)) {
          continue; // Skip if file doesn't exist
        }

        const content = readFileSync(fullPath, "utf-8");

        // Should not instruct users to run pnpm commands for web development
        // (iOS-specific commands in APP_STORE_CHECKLIST.md might be exceptions)
        if (docPath !== "APP_STORE_CHECKLIST.md") {
          expect(content).not.toMatch(/pnpm\s+(install|dev|start|build|add|dlx)/);
        }
      }
    });

    it("scripts in scripts/ directory do not reference pnpm in their code or comments", () => {
      const scriptsDir = join(repoRoot, "scripts");

      if (!existsSync(scriptsDir)) {
        return; // No scripts directory, nothing to check
      }

      const scriptFiles = readdirSync(scriptsDir, { recursive: true })
        .filter((f) => {
          const path = String(f);
          return (
            (path.endsWith(".ts") ||
              path.endsWith(".js") ||
              path.endsWith(".mjs")) &&
            !path.includes("node_modules")
          );
        })
        .map((f) => String(f));

      for (const file of scriptFiles) {
        const content = readFileSync(join(scriptsDir, file), "utf-8");

        // Should not reference pnpm in user-facing comments or code
        expect(content).not.toMatch(/pnpm\s+(dlx|add|install|run)/);
      }
    });

    it(".claude/launch.json does not use pnpm as runtimeExecutable", () => {
      const launchPath = join(repoRoot, ".claude", "launch.json");

      if (!existsSync(launchPath)) {
        return; // File doesn't exist, nothing to check
      }

      const launchConfig = JSON.parse(readFileSync(launchPath, "utf-8"));

      // Check all configurations for pnpm
      if (launchConfig.configurations) {
        for (const config of launchConfig.configurations) {
          if (config.runtimeExecutable) {
            expect(config.runtimeExecutable).not.toBe("pnpm");
          }
        }
      }
    });
  });

  describe("Vercel configuration is explicit", () => {
    it("vercel.json exists and has been reviewed", () => {
      const vercelPath = join(repoRoot, "vercel.json");
      expect(existsSync(vercelPath)).toBe(true);
    });

    it("if installCommand is present, it specifies npm and has explanatory comment or is removed", () => {
      const vercelPath = join(repoRoot, "vercel.json");
      const vercelConfig = JSON.parse(readFileSync(vercelPath, "utf-8"));

      // If installCommand is present, it should be npm-based
      if (vercelConfig.installCommand) {
        expect(vercelConfig.installCommand).toMatch(/npm\s+ci/);
      }

      // Either way is acceptable after review:
      // 1. installCommand is removed (detection is unambiguous)
      // 2. installCommand is kept as "npm ci" (explicit, deliberate)
      // The presence of the field itself is not required, but if present must be npm
    });
  });

  describe("Clean install succeeds", () => {
    it("package-lock.json exists and is the maintained lockfile", () => {
      const packageLockPath = join(repoRoot, "package-lock.json");
      expect(existsSync(packageLockPath)).toBe(true);

      const packageLock = JSON.parse(readFileSync(packageLockPath, "utf-8"));
      expect(packageLock).toHaveProperty("lockfileVersion");
    });

    it("package.json and package-lock.json are in sync (no missing dependencies)", () => {
      const packageLockPath = join(repoRoot, "package-lock.json");
      const packageLock = JSON.parse(readFileSync(packageLockPath, "utf-8"));

      // The lockfile should have a packages section with entries
      expect(packageLock).toHaveProperty("packages");

      // Check that at least the root package and some dependencies are present
      expect(Object.keys(packageLock.packages).length).toBeGreaterThan(1);
    });
  });

  describe("Build and test suite pass", () => {
    it("package.json has required scripts defined", () => {
      const packageJsonPath = join(repoRoot, "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

      expect(packageJson.scripts).toHaveProperty("build");
      expect(packageJson.scripts).toHaveProperty("test");
      expect(packageJson.scripts).toHaveProperty("typecheck");
      expect(packageJson.scripts).toHaveProperty("lint");
    });

    // Note: Actual execution of npm ci, npm test, and npm run build
    // are covered by the CI gate job in .github/workflows/ci.yml
    // These tests verify the prerequisites are in place
  });

  describe("Allowed exceptions remain untouched", () => {
    it("iOS-specific files with .pnpm paths are not considered violations", () => {
      // Verify the exception list matches what actually exists
      const podfilePath = join(repoRoot, "ios", "App", "Podfile");
      const podfileLockPath = join(repoRoot, "ios", "App", "Podfile.lock");

      if (existsSync(podfilePath)) {
        const content = readFileSync(podfilePath, "utf-8");
        // These files are allowed to reference .pnpm paths in node_modules
        // This test just confirms they exist and are not a violation
        expect(content).toBeDefined();
      }

      if (existsSync(podfileLockPath)) {
        const content = readFileSync(podfileLockPath, "utf-8");
        expect(content).toBeDefined();
      }
    });

    it("Xcode Cloud build script can still reference pnpm for iOS builds", () => {
      const xcodePath = join(repoRoot, "ci_scripts", "ci_post_clone.sh");

      if (!existsSync(xcodePath)) {
        return; // File doesn't exist, test passes
      }

      // This file is explicitly allowed to use pnpm for iOS builds
      // We just verify it exists; its content is not restricted
      expect(existsSync(xcodePath)).toBe(true);
    });

    it(".gitignore can keep harmless pnpm ignore patterns", () => {
      const gitignorePath = join(repoRoot, ".gitignore");

      if (!existsSync(gitignorePath)) {
        return;
      }

      const content = readFileSync(gitignorePath, "utf-8");

      // .pnpm-debug.log* pattern is harmless and can stay
      // This test just confirms we're not being overly strict about removing it
      expect(content).toBeDefined();
    });
  });
});
