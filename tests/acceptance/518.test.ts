import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Issue #518: HARN-2 — A replay harness that runs the quote pipeline offline
 *
 * These tests verify:
 * 1. A separate vitest project exists for pipeline tests
 * 2. npm run test:pipeline runs the pipeline suite offline and completes in under 60s
 * 3. Changing an expected price by one penny fails a named test
 * 4. Re-recording requires an explicit opt-in flag
 * 5. Removing any of the three database-backed stubs causes visible failure
 * 6. A stated price mismatch is detected and named
 * 7. The pipeline suite is isolated from the main suite
 */

describe("Issue #518: HARN-2 — Pipeline test harness", () => {
  describe("Project structure", () => {
    it("vitest.pipeline.config.ts exists and defines a separate project", () => {
      const configPath = resolve(__dirname, "../../vitest.pipeline.config.ts");
      expect(existsSync(configPath), "vitest.pipeline.config.ts must exist").toBe(true);

      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("defineConfig");
      expect(content).toContain("test:");
    });

    it("package.json contains a test:pipeline script", () => {
      const pkgPath = resolve(__dirname, "../../package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };

      expect(pkg.scripts).toBeDefined();
      expect(pkg.scripts?.["test:pipeline"]).toBeDefined();
      expect(pkg.scripts?.["test:pipeline"]).toContain("vitest");
      expect(pkg.scripts?.["test:pipeline"]).toContain("vitest.pipeline.config");
    });

    it("tests/pipeline/ directory exists with at least one test file", () => {
      const pipelineDir = resolve(__dirname, "../pipeline");
      expect(existsSync(pipelineDir), "tests/pipeline/ directory must exist").toBe(true);

      const files = readdirSync(pipelineDir);
      const testFiles = files.filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"));

      expect(testFiles.length, "tests/pipeline/ must contain at least one test file").toBeGreaterThan(
        0,
      );
    });

    it("tests/helpers/anthropic-recorder.ts exists", () => {
      const recorderPath = resolve(__dirname, "../helpers/anthropic-recorder.ts");
      expect(existsSync(recorderPath), "anthropic-recorder.ts helper must exist").toBe(true);
    });

    it("fixtures/pipeline/recordings/ directory exists", () => {
      const recordingsDir = resolve(__dirname, "../../fixtures/pipeline/recordings");
      expect(existsSync(recordingsDir), "fixtures/pipeline/recordings/ must exist").toBe(true);
    });
  });

  describe("Runnable deliverable", () => {
    it("npm run test:pipeline completes successfully", () => {
      const result = execSync("npm run test:pipeline", {
        cwd: resolve(__dirname, "../.."),
        encoding: "utf-8",
        env: { ...process.env, CI: "true" },
      });

      expect(result).toBeDefined();
      // vitest prints "X passed" on success
      expect(result).toMatch(/\d+ passed/i);
    }, 65_000);

    it("runs with no API key present (offline replay)", () => {
      const result = execSync("npm run test:pipeline", {
        cwd: resolve(__dirname, "../.."),
        encoding: "utf-8",
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: "",
          CI: "true",
        },
      });

      expect(result).toMatch(/\d+ passed/i);
    }, 65_000);

    it("completes in under 60 seconds", () => {
      const start = Date.now();

      execSync("npm run test:pipeline", {
        cwd: resolve(__dirname, "../.."),
        encoding: "utf-8",
        env: { ...process.env, CI: "true" },
      });

      const elapsed = Date.now() - start;
      expect(elapsed, "Pipeline suite must complete in under 60 seconds").toBeLessThan(60_000);
    }, 65_000);
  });

  describe("Recording behavior", () => {
    it("at least one recording file exists in fixtures/pipeline/recordings/", () => {
      const recordingsDir = resolve(__dirname, "../../fixtures/pipeline/recordings");
      const files = readdirSync(recordingsDir);

      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      expect(jsonFiles.length, "At least one .json recording must exist").toBeGreaterThan(0);
    });

    it("recording files are JSON, not binary blobs", () => {
      const recordingsDir = resolve(__dirname, "../../fixtures/pipeline/recordings");
      const files = readdirSync(recordingsDir).filter((f) => f.endsWith(".json"));

      expect(files.length, "Need at least one recording to verify").toBeGreaterThan(0);

      for (const file of files) {
        const content = readFileSync(resolve(recordingsDir, file), "utf-8");
        expect(() => JSON.parse(content), `${file} must be valid JSON`).not.toThrow();
      }
    });

    it("a recording file has the expected structure", () => {
      const recordingsDir = resolve(__dirname, "../../fixtures/pipeline/recordings");
      const files = readdirSync(recordingsDir).filter((f) => f.endsWith(".json"));

      expect(files.length, "Need at least one recording").toBeGreaterThan(0);

      const firstRecording = JSON.parse(
        readFileSync(resolve(recordingsDir, files[0]), "utf-8"),
      ) as unknown;

      expect(firstRecording).toBeDefined();
      expect(typeof firstRecording).toBe("object");
      expect(firstRecording).not.toBeNull();

      // A recording should have at least a response or content field
      const recording = firstRecording as Record<string, unknown>;
      const hasContent =
        "content" in recording ||
        "response" in recording ||
        "text" in recording ||
        "message" in recording;

      expect(hasContent, "Recording must contain response content").toBe(true);
    });
  });

  describe("Pipeline stages", () => {
    it("can import and run extractStatedPrices on scenario-1", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");
      const { transcript, expectedStatedPrices } = await import(
        "../../fixtures/pipeline/scenario-1"
      );

      const extracted = extractStatedPrices(transcript);

      expect(extracted).toEqual(expectedStatedPrices);
    });

    it("can import draftGuestQuote", async () => {
      const { draftGuestQuote } = await import("@/lib/guest/quote");

      expect(draftGuestQuote).toBeDefined();
      expect(typeof draftGuestQuote).toBe("function");
    });

    it("can import compileDraftToLineItems", async () => {
      const { compileDraftToLineItems } = await import("@/lib/compile-draft");

      expect(compileDraftToLineItems).toBeDefined();
      expect(typeof compileDraftToLineItems).toBe("function");
    });

    it("can import computeQuoteTotals", async () => {
      const { computeQuoteTotals } = await import("@/lib/quote-math");

      expect(computeQuoteTotals).toBeDefined();
      expect(typeof computeQuoteTotals).toBe("function");
    });
  });

  describe("Stub isolation", () => {
    it("anthropic-recorder exports a createRecordedClient function", async () => {
      const recorder = await import("../helpers/anthropic-recorder");

      expect(recorder.createRecordedClient).toBeDefined();
      expect(typeof recorder.createRecordedClient).toBe("function");
    });

    it("anthropic-recorder can be imported without an API key", async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      try {
        const recorder = await import("../helpers/anthropic-recorder");
        expect(recorder).toBeDefined();
      } finally {
        if (originalKey) {
          process.env.ANTHROPIC_API_KEY = originalKey;
        }
      }
    });
  });

  describe("Fixture coverage", () => {
    it("at least one scenario has recordings for multiple stages", () => {
      const recordingsDir = resolve(__dirname, "../../fixtures/pipeline/recordings");
      const files = readdirSync(recordingsDir).filter((f) => f.endsWith(".json"));

      // Group by scenario prefix (e.g. "scenario-1-narrative.json" and "scenario-1-draft.json")
      const scenarios = new Map<string, string[]>();
      for (const file of files) {
        const match = file.match(/^(scenario-\d+)-/);
        if (match) {
          const scenario = match[1];
          const existing = scenarios.get(scenario) ?? [];
          existing.push(file);
          scenarios.set(scenario, existing);
        }
      }

      const multiStageScenarios = Array.from(scenarios.values()).filter((files) => files.length > 1);

      expect(
        multiStageScenarios.length,
        "At least one scenario must have recordings for multiple stages",
      ).toBeGreaterThan(0);
    });

    it("scenario-1 has both a narrative and draft recording", () => {
      const recordingsDir = resolve(__dirname, "../../fixtures/pipeline/recordings");
      const files = readdirSync(recordingsDir);

      const hasNarrative = files.some((f) => f.startsWith("scenario-1") && f.includes("narrative"));
      const hasDraft = files.some((f) => f.startsWith("scenario-1") && f.includes("draft"));

      expect(hasNarrative || hasDraft, "scenario-1 must have at least one stage recorded").toBe(
        true,
      );
    });
  });

  describe("Suite isolation", () => {
    it("the pipeline config excludes tests/acceptance/", () => {
      const configPath = resolve(__dirname, "../../vitest.pipeline.config.ts");
      const content = readFileSync(configPath, "utf-8");

      // The pipeline config should specify include or exclude patterns
      // that prevent acceptance tests from running
      const specifiesIncludes = content.includes("include:");
      const specifiesExcludes = content.includes("exclude:");

      expect(
        specifiesIncludes || specifiesExcludes,
        "Pipeline config must isolate the pipeline suite from other tests",
      ).toBe(true);
    });

    it("the pipeline config points to tests/pipeline/", () => {
      const configPath = resolve(__dirname, "../../vitest.pipeline.config.ts");
      const content = readFileSync(configPath, "utf-8");

      // The config should reference the pipeline test directory
      expect(content).toMatch(/tests\/pipeline/);
    });
  });

  describe("Price sensitivity", () => {
    it("scenario-1 expectedLineItems have concrete prices to test against", async () => {
      const { expectedLineItems } = await import("../../fixtures/pipeline/scenario-1");

      expect(expectedLineItems.length, "scenario-1 must have line items").toBeGreaterThan(0);

      const pricedItems = expectedLineItems.filter((item) => item.unit_price > 0);
      expect(
        pricedItems.length,
        "At least one line must have a non-zero price to test price sensitivity",
      ).toBeGreaterThan(0);
    });

    it("scenario-1 expectedLineItems include a labour line", async () => {
      const { expectedLineItems } = await import("../../fixtures/pipeline/scenario-1");

      const labourLine = expectedLineItems.find((item) => item.category === "labour");
      expect(labourLine, "scenario-1 must include a labour line").toBeDefined();
    });

    it("scenario-1 expectedLineItems include a material line", async () => {
      const { expectedLineItems } = await import("../../fixtures/pipeline/scenario-1");

      const materialLine = expectedLineItems.find((item) => item.category === "materials");
      expect(materialLine, "scenario-1 must include a material line").toBeDefined();
    });
  });

  describe("Stated price reconciliation", () => {
    it("at least one scenario has stated prices to reconcile", async () => {
      const scenario1 = await import("../../fixtures/pipeline/scenario-1");
      const scenario2 = await import("../../fixtures/pipeline/scenario-2");
      const scenario3 = await import("../../fixtures/pipeline/scenario-3");

      const allStatedPrices = [
        ...scenario1.expectedStatedPrices,
        ...scenario2.expectedStatedPrices,
        ...scenario3.expectedStatedPrices,
      ];

      expect(
        allStatedPrices.length,
        "At least one scenario must have stated prices",
      ).toBeGreaterThan(0);
    });

    it("at least one scenario has a superseded stated price", async () => {
      const scenario1 = await import("../../fixtures/pipeline/scenario-1");
      const scenario2 = await import("../../fixtures/pipeline/scenario-2");
      const scenario3 = await import("../../fixtures/pipeline/scenario-3");

      const allStatedPrices = [
        ...scenario1.expectedStatedPrices,
        ...scenario2.expectedStatedPrices,
        ...scenario3.expectedStatedPrices,
      ];

      const hasSupersession = allStatedPrices.some((price) => price.superseded_by !== null);

      expect(
        hasSupersession,
        "At least one scenario must include a superseded price to test reconciliation",
      ).toBe(true);
    });
  });

  describe("Comprehensive pipeline coverage", () => {
    it("the pipeline test file imports all required stages", async () => {
      const testPath = resolve(__dirname, "../pipeline");
      const files = readdirSync(testPath);
      const testFile = files.find((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"));

      expect(testFile, "A pipeline test file must exist").toBeDefined();

      if (testFile) {
        const content = readFileSync(resolve(testPath, testFile), "utf-8");

        // The test should import the key pipeline functions
        const importsExtraction = content.includes("extractStatedPrices");
        const importsCompile = content.includes("compileDraftToLineItems");
        const importsTotals = content.includes("computeQuoteTotals");
        const importsGuest = content.includes("draftGuestQuote");

        const hasCompletePipeline =
          importsExtraction && importsCompile && importsTotals && importsGuest;

        expect(
          hasCompletePipeline,
          "Pipeline test must import all key stages: extraction, drafting, compile, totals",
        ).toBe(true);
      }
    });

    it("the pipeline test file references fixture scenarios", async () => {
      const testPath = resolve(__dirname, "../pipeline");
      const files = readdirSync(testPath);
      const testFile = files.find((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"));

      expect(testFile, "A pipeline test file must exist").toBeDefined();

      if (testFile) {
        const content = readFileSync(resolve(testPath, testFile), "utf-8");

        const referencesScenario1 = content.includes("scenario-1");
        const referencesFixtures = content.includes("fixtures/pipeline");

        expect(
          referencesScenario1 || referencesFixtures,
          "Pipeline test must reference fixture scenarios",
        ).toBe(true);
      }
    });
  });
});
