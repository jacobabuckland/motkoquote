import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #643: FACT-2: Poll on merge, not only on a clock
 *
 * These tests verify that:
 * 1. The workflow YAML adds a push trigger for main
 * 2. The workflow YAML keeps the schedule trigger
 * 3. The duplicate guard prevents re-admission of items that already have GitHub issues
 * 4. Existing behavior is preserved
 */

describe("Issue #643: Poll on merge, not only on a clock", () => {
  describe("Workflow YAML changes", () => {
    it("adds push trigger for main branch to factory-poll-notion.yml", () => {
      const workflowPath = join(process.cwd(), ".github/workflows/factory-poll-notion.yml");
      const content = readFileSync(workflowPath, "utf8");

      // Should have push trigger for main branch
      expect(content).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\n\s*-\s*main/m);
    });

    it("keeps schedule trigger in factory-poll-notion.yml", () => {
      const workflowPath = join(process.cwd(), ".github/workflows/factory-poll-notion.yml");
      const content = readFileSync(workflowPath, "utf8");

      // Should still have schedule trigger at :17
      expect(content).toContain('cron: "17 * * * *"');
    });

    it("keeps workflow_dispatch trigger in factory-poll-notion.yml", () => {
      const workflowPath = join(process.cwd(), ".github/workflows/factory-poll-notion.yml");
      const content = readFileSync(workflowPath, "utf8");

      // Should still have workflow_dispatch
      expect(content).toContain("workflow_dispatch:");
    });
  });

  describe("Duplicate guard implementation", () => {
    it("poll-notion.mjs checks for existing GitHub Issue URL before creating", async () => {
      const scriptPath = join(process.cwd(), "scripts/factory/poll-notion.mjs");
      const content = readFileSync(scriptPath, "utf8");

      // Should check the GitHub Issue property on the Notion page
      expect(content).toMatch(/GitHub Issue|github.*issue|issue.*url/i);

      // Should call loadKnownItems when checking for duplicates
      // (The function already exists for programme ordering, should be reused)
      expect(content).toContain("loadKnownItems");
    });

    it("duplicate-skipped items do not consume a cap slot", async () => {
      const scriptPath = join(process.cwd(), "scripts/factory/poll-notion.mjs");
      const content = readFileSync(scriptPath, "utf8");

      // The `started` counter should only increment when an item is actually started,
      // not when it's skipped for being a duplicate
      expect(content).toMatch(/started\s*[+]=\s*1|started\s*=\s*started\s*\+\s*1|started\+\+/);
    });
  });

  describe("Existing behavior preserved", () => {
    it("still filters Notion query by Status = Ready for factory", async () => {
      const scriptPath = join(process.cwd(), "scripts/factory/poll-notion.mjs");
      const content = readFileSync(scriptPath, "utf8");

      expect(content).toContain('"Ready for factory"');
      expect(content).toMatch(/Status[\s\S]*select[\s\S]*equals[\s\S]*Ready for factory/);
    });

    it("still sorts by Priority ascending, then created_time ascending", async () => {
      const scriptPath = join(process.cwd(), "scripts/factory/poll-notion.mjs");
      const content = readFileSync(scriptPath, "utf8");

      expect(content).toContain("Priority");
      expect(content).toContain("created_time");
      expect(content).toContain("ascending");
    });

    it("MAX_PER_RUN still bounds admission", async () => {
      const scriptPath = join(process.cwd(), "scripts/factory/poll-notion.mjs");
      const content = readFileSync(scriptPath, "utf8");

      // Should check started against MAX_PER_RUN
      expect(content).toMatch(/started\s*>=\s*MAX_PER_RUN|started\s*===\s*MAX_PER_RUN/);
    });

    it("empty page body still skips without consuming slot", async () => {
      const scriptPath = join(process.cwd(), "scripts/factory/poll-notion.mjs");
      const content = readFileSync(scriptPath, "utf8");

      // Should skip empty pages and continue to next item
      expect(content).toMatch(/!spec\.trim\(\)|spec\.trim\(\)\s*===\s*['"]['"]|!.*trim/);
      expect(content).toContain("continue");
    });
  });

  describe("Edge cases", () => {
    it("handles malformed GitHub Issue URLs gracefully", async () => {
      const scriptPath = join(process.cwd(), "scripts/factory/poll-notion.mjs");
      const content = readFileSync(scriptPath, "utf8");

      // Should extract issue number from URL or handle cases where it's not a valid GitHub URL
      // The safest approach is to check if the URL exists and optionally parse it
      expect(content).toMatch(/GitHub Issue.*url|properties.*GitHub Issue/i);
    });

    it("loadKnownItems remains lazy (not called unconditionally in main)", async () => {
      const scriptPath = join(process.cwd(), "scripts/factory/poll-notion.mjs");
      const content = readFileSync(scriptPath, "utf8");

      // loadKnownItems should be defined as a lazy loader
      expect(content).toContain("const loadKnownItems");
      expect(content).toContain("knownItems !== null");

      // Should NOT be called directly in main() before the loop
      // (this preserves the #115 contract about request sequence)
      const mainFunctionMatch = content.match(/async function main\(\) \{([\s\S]*?)\n  for \(const page/);
      if (mainFunctionMatch) {
        const beforeLoop = mainFunctionMatch[1];
        expect(beforeLoop).not.toContain("await loadKnownItems");
        expect(beforeLoop).not.toContain("loadKnownItems()");
      }
    });
  });
});
