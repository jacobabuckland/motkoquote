import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Issue #113: Add a DOM test environment and shared Capacitor mocks", () => {
  describe("Shared Capacitor mock helpers exist", () => {
    it("tests/helpers/capacitor.ts exists", () => {
      const helperPath = resolve(__dirname, "../helpers/capacitor.ts");
      expect(existsSync(helperPath)).toBe(true);
    });

    it("exports mockNativePlatform helper", async () => {
      const helperPath = resolve(__dirname, "../helpers/capacitor.ts");
      if (!existsSync(helperPath)) {
        throw new Error("tests/helpers/capacitor.ts does not exist yet");
      }

      const { mockNativePlatform } = await import("../helpers/capacitor");
      expect(typeof mockNativePlatform).toBe("function");
    });

    it("exports mockCapacitorPlugins helper", async () => {
      const helperPath = resolve(__dirname, "../helpers/capacitor.ts");
      if (!existsSync(helperPath)) {
        throw new Error("tests/helpers/capacitor.ts does not exist yet");
      }

      const { mockCapacitorPlugins } = await import("../helpers/capacitor");
      expect(typeof mockCapacitorPlugins).toBe("function");
    });

    it("mockCapacitorPlugins returns plugin mocks with call recording", async () => {
      const helperPath = resolve(__dirname, "../helpers/capacitor.ts");
      if (!existsSync(helperPath)) {
        throw new Error("tests/helpers/capacitor.ts does not exist yet");
      }

      const { mockCapacitorPlugins } = await import("../helpers/capacitor");
      const mocks = mockCapacitorPlugins();

      // Should have mocks for the five installed plugins
      expect(mocks).toHaveProperty("App");
      expect(mocks).toHaveProperty("Haptics");
      expect(mocks).toHaveProperty("PushNotifications");
      expect(mocks).toHaveProperty("Share");
      expect(mocks).toHaveProperty("SplashScreen");

      // Each plugin mock should have a getCalls method for assertion
      expect(typeof mocks.App.getCalls).toBe("function");
      expect(typeof mocks.Haptics.getCalls).toBe("function");
    });
  });

  describe("Example DOM tests exist proving the scaffolding works", () => {
    it("a DOM test example file exists in tests/examples/", () => {
      // The Engineer will create example tests in tests/examples/ to prove
      // the DOM environment and Capacitor mocking work end-to-end
      const examplesDir = resolve(__dirname, "../examples");
      expect(existsSync(examplesDir)).toBe(true);
    });

    it("at least one example test demonstrates DOM + Capacitor", () => {
      const examplesDir = resolve(__dirname, "../examples");

      if (!existsSync(examplesDir)) {
        throw new Error("tests/examples directory does not exist yet");
      }

      const files = readdirSync(examplesDir).filter((f: string) =>
        f.endsWith(".test.ts") || f.endsWith(".test.tsx")
      );

      expect(files.length).toBeGreaterThan(0);
    });
  });

  describe("Testing conventions are documented in AGENTS.md", () => {
    it("AGENTS.md exists", () => {
      const agentsPath = resolve(__dirname, "../../AGENTS.md");
      expect(existsSync(agentsPath)).toBe(true);
    });

    it("AGENTS.md documents DOM test environment opt-in", () => {
      const agentsPath = resolve(__dirname, "../../AGENTS.md");
      const content = readFileSync(agentsPath, "utf-8");

      // Must explain how to opt into DOM environment
      expect(content).toMatch(/@vitest-environment|DOM.*environment/i);
    });

    it("AGENTS.md documents Capacitor mocking convention", () => {
      const agentsPath = resolve(__dirname, "../../AGENTS.md");
      const content = readFileSync(agentsPath, "utf-8");

      // Must reference the shared capacitor helpers
      expect(content).toMatch(/capacitor.*mock|mockCapacitorPlugins|mockNativePlatform/i);
    });

    it("AGENTS.md documents default is web (isNativePlatform false)", () => {
      const agentsPath = resolve(__dirname, "../../AGENTS.md");
      const content = readFileSync(agentsPath, "utf-8");

      // Must state that default is web, not native
      expect(content).toMatch(/default.*web|web.*default.*platform/i);
    });
  });

  describe("happy-dom is installed as devDependency", () => {
    it("package.json lists happy-dom in devDependencies", () => {
      const pkgPath = resolve(__dirname, "../../package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

      // Either happy-dom or jsdom is acceptable, but happy-dom is preferred
      const hasHappyDom = pkg.devDependencies?.["happy-dom"];
      const hasJsdom = pkg.devDependencies?.["jsdom"];

      expect(hasHappyDom || hasJsdom).toBeTruthy();
    });
  });

  describe("Existing test suite remains untouched", () => {
    it("vitest.config.ts still defaults to node environment globally", () => {
      const configPath = resolve(__dirname, "../../vitest.config.ts");
      const content = readFileSync(configPath, "utf-8");

      // Global config should still be node (DOM is per-file opt-in)
      expect(content).toMatch(/environment:\s*["']node["']/);
    });

    it("existing acceptance tests do not declare a vitest-environment", () => {
      // The four existing acceptance tests should remain node-environment
      const existingTests = [
        "81.test.ts",
        "99.test.ts",
        "106.test.ts",
        "108.test.ts",
      ];

      for (const testFile of existingTests) {
        const testPath = resolve(__dirname, testFile);
        const content = readFileSync(testPath, "utf-8");

        // Should NOT have a vitest-environment directive (stays in default node)
        expect(content).not.toContain("@vitest-environment");
      }
    });
  });
});
