import { describe, it, expect, beforeEach } from "vitest";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Type definitions for the verdict system
interface VerdictCriterion {
  file: string;
  lineRange: string;
  name: string;
  status: "satisfied" | "failed";
}

interface VerdictFinding {
  criterion: string;
  file: string;
  lineRange: string;
  message: string;
}

interface Verdict {
  cycle: number;
  commit: string;
  criteria: VerdictCriterion[];
  findings: VerdictFinding[];
}

interface ValidationResult {
  valid: boolean;
  reason: string;
}

describe("QA stateful verdicts", () => {
  describe("verdict persistence", () => {
    it("extracts verdicts from issue comments with HTML comment blocks", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const extractVerdicts = mod.extractVerdicts;

      const comments = [
        {
          body: `**QA findings** (cycle 1 of 3)

Some findings here.

<!-- qa-verdict-1 ${JSON.stringify({
            cycle: 1,
            commit: "abc123",
            criteria: [
              {
                file: "src/app/page.tsx",
                lineRange: "10-20",
                name: "spec-fidelity",
                status: "satisfied",
              },
            ],
            findings: [],
          })} -->`,
        },
        {
          body: `**QA findings** (cycle 2 of 3)

More findings.

<!-- qa-verdict-2 ${JSON.stringify({
            cycle: 2,
            commit: "def456",
            criteria: [],
            findings: [
              {
                criterion: "spec-fidelity",
                file: "src/app/page.tsx",
                lineRange: "10-20",
                message: "Still broken",
              },
            ],
          })} -->`,
        },
      ];

      const verdicts = await extractVerdicts(comments);

      expect(verdicts).toHaveLength(2);
      expect(verdicts[0].cycle).toBe(1);
      expect(verdicts[0].commit).toBe("abc123");
      expect(verdicts[0].criteria).toHaveLength(1);
      expect(verdicts[0].criteria[0].status).toBe("satisfied");
      expect(verdicts[1].cycle).toBe(2);
      expect(verdicts[1].findings).toHaveLength(1);
    });

    it("returns empty array when no verdict blocks exist", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const extractVerdicts = mod.extractVerdicts;

      const comments = [
        { body: "**QA findings**\n\nNo verdict block here." },
        { body: "Some other comment." },
      ];

      const verdicts = await extractVerdicts(comments);

      expect(verdicts).toEqual([]);
    });

    it("fails open with empty array when verdict JSON is malformed", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const extractVerdicts = mod.extractVerdicts;

      const comments = [
        {
          body: `**QA findings**

<!-- qa-verdict-1 {invalid json here} -->`,
        },
      ];

      const verdicts = await extractVerdicts(comments);

      // Should fail open rather than throwing
      expect(verdicts).toEqual([]);
    });
  });

  describe("finding validation", () => {
    it("rejects re-raised finding when code region unchanged since prior cycle", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const validateFinding = mod.validateFinding;

      const priorVerdict: Verdict = {
        cycle: 1,
        commit: "abc123",
        criteria: [
          {
            file: "src/app/page.tsx",
            lineRange: "10-20",
            name: "spec-fidelity",
            status: "satisfied",
          },
        ],
        findings: [],
      };

      const finding: VerdictFinding = {
        criterion: "spec-fidelity",
        file: "src/app/page.tsx",
        lineRange: "10-20",
        message: "Still wrong",
      };

      // Mock git diff showing no changes in the region
      const currentCommit = "def456";
      const gitDiffOutput = ""; // Empty diff = no changes

      const result: ValidationResult = await validateFinding(
        finding,
        priorVerdict,
        currentCommit,
        gitDiffOutput,
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("unchanged since");
    });

    it("accepts re-raised finding when code region changed since prior cycle", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const validateFinding = mod.validateFinding;

      const priorVerdict: Verdict = {
        cycle: 1,
        commit: "abc123",
        criteria: [
          {
            file: "src/app/page.tsx",
            lineRange: "10-20",
            name: "spec-fidelity",
            status: "satisfied",
          },
        ],
        findings: [],
      };

      const finding: VerdictFinding = {
        criterion: "spec-fidelity",
        file: "src/app/page.tsx",
        lineRange: "10-20",
        message:
          "The idempotency key changed from per-attempt to per-collection at line 15",
      };

      const currentCommit = "def456";
      const gitDiffOutput = `diff --git a/src/app/page.tsx b/src/app/page.tsx
index abc123..def456 100644
--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -15,1 +15,1 @@
-  idempotencyKey: \`\${collection.id}:\${attempt}\`
+  idempotencyKey: collection.id
`; // Non-empty diff = changes

      const result: ValidationResult = await validateFinding(
        finding,
        priorVerdict,
        currentCommit,
        gitDiffOutput,
      );

      expect(result.valid).toBe(true);
    });

    it("rejects re-raised finding that does not name what changed", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const validateFinding = mod.validateFinding;

      const priorVerdict: Verdict = {
        cycle: 1,
        commit: "abc123",
        criteria: [
          {
            file: "src/lib/truelayer.ts",
            lineRange: "50-60",
            name: "timeout-wrapper",
            status: "satisfied",
          },
        ],
        findings: [],
      };

      const finding: VerdictFinding = {
        criterion: "timeout-wrapper",
        file: "src/lib/truelayer.ts",
        lineRange: "50-60",
        message: "Still missing timeout wrapper",
      };

      const currentCommit = "def456";
      const gitDiffOutput = `diff --git a/src/lib/truelayer.ts b/src/lib/truelayer.ts
index abc123..def456 100644
--- a/src/lib/truelayer.ts
+++ b/src/lib/truelayer.ts
@@ -55,1 +55,1 @@
   // Added comment
`; // Code changed, but finding doesn't reference it

      const result: ValidationResult = await validateFinding(
        finding,
        priorVerdict,
        currentCommit,
        gitDiffOutput,
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("does not name what changed");
    });

    it("accepts finding for criterion not in prior verdicts (new finding)", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const validateFinding = mod.validateFinding;

      const priorVerdict: Verdict = {
        cycle: 1,
        commit: "abc123",
        criteria: [
          {
            file: "src/app/page.tsx",
            lineRange: "10-20",
            name: "spec-fidelity",
            status: "satisfied",
          },
        ],
        findings: [],
      };

      const finding: VerdictFinding = {
        criterion: "rls-check",
        file: "src/lib/database.ts",
        lineRange: "100-110",
        message: "Service role key used in user-facing route",
      };

      const currentCommit = "def456";
      const gitDiffOutput = ""; // Doesn't matter for new finding

      const result: ValidationResult = await validateFinding(
        finding,
        priorVerdict,
        currentCommit,
        gitDiffOutput,
      );

      expect(result.valid).toBe(true);
      expect(result.reason).toContain("new finding");
    });
  });

  describe("verdict block formatting", () => {
    it("formats verdict as HTML comment block for appending to issue comment", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const appendVerdictBlock = mod.appendVerdictBlock;

      const verdict: Verdict = {
        cycle: 2,
        commit: "abc123",
        criteria: [
          {
            file: "src/app/page.tsx",
            lineRange: "10-20",
            name: "spec-fidelity",
            status: "satisfied",
          },
        ],
        findings: [
          {
            criterion: "rls-check",
            file: "src/lib/db.ts",
            lineRange: "50-60",
            message: "Service role key in user path",
          },
        ],
      };

      const block = appendVerdictBlock(verdict);

      expect(block).toContain("<!-- qa-verdict-2");
      expect(block).toContain('"cycle":2');
      expect(block).toContain('"commit":"abc123"');
      expect(block).toContain('"file":"src/app/page.tsx"');
      expect(block).toContain("-->");
    });
  });

  describe("integration with git diff", () => {
    let tempDir: string;

    beforeEach(async () => {
      // Create a temporary git repository for testing diff logic
      const { stdout } = await execAsync("mktemp -d");
      tempDir = stdout.trim();
      await execAsync(`git init ${tempDir}`);
      await execAsync(`git -C ${tempDir} config user.name "Test"`);
      await execAsync(`git -C ${tempDir} config user.email "test@test.com"`);
    });

    it("detects no change when file unchanged between commits", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const checkRegionChanged = mod.checkRegionChanged;

      // Create initial file and commit
      await execAsync(
        `echo "line 1\nline 2\nline 3\nline 4\nline 5" > ${tempDir}/test.ts`,
      );
      await execAsync(`git -C ${tempDir} add test.ts`);
      await execAsync(`git -C ${tempDir} commit -m "initial"`);
      const { stdout: commit1 } = await execAsync(`git -C ${tempDir} rev-parse HEAD`);
      const priorCommit = commit1.trim();

      // Create another file and commit (test.ts unchanged)
      await execAsync(`echo "other" > ${tempDir}/other.ts`);
      await execAsync(`git -C ${tempDir} add other.ts`);
      await execAsync(`git -C ${tempDir} commit -m "add other"`);
      const { stdout: commit2 } = await execAsync(`git -C ${tempDir} rev-parse HEAD`);
      const currentCommit = commit2.trim();

      const changed = await checkRegionChanged(
        tempDir,
        "test.ts",
        priorCommit,
        currentCommit,
      );

      expect(changed).toBe(false);
    });

    it("detects change when file modified between commits", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const checkRegionChanged = mod.checkRegionChanged;

      // Create initial file and commit
      await execAsync(
        `echo "line 1\nline 2\nline 3\nline 4\nline 5" > ${tempDir}/test.ts`,
      );
      await execAsync(`git -C ${tempDir} add test.ts`);
      await execAsync(`git -C ${tempDir} commit -m "initial"`);
      const { stdout: commit1 } = await execAsync(`git -C ${tempDir} rev-parse HEAD`);
      const priorCommit = commit1.trim();

      // Modify the file and commit
      await execAsync(
        `echo "line 1\nLINE 2 CHANGED\nline 3\nline 4\nline 5" > ${tempDir}/test.ts`,
      );
      await execAsync(`git -C ${tempDir} add test.ts`);
      await execAsync(`git -C ${tempDir} commit -m "modify test"`);
      const { stdout: commit2 } = await execAsync(`git -C ${tempDir} rev-parse HEAD`);
      const currentCommit = commit2.trim();

      const changed = await checkRegionChanged(
        tempDir,
        "test.ts",
        priorCommit,
        currentCommit,
      );

      expect(changed).toBe(true);
    });
  });

  describe("first cycle with no prior verdicts", () => {
    it("behaves as stateless review when no prior verdicts exist", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const extractVerdicts = mod.extractVerdicts;

      const comments: Array<{ body: string }> = [];

      const verdicts = await extractVerdicts(comments);

      expect(verdicts).toEqual([]);
      // When verdicts array is empty, QA agent should receive no
      // "settled criteria" section in its prompt, behaving exactly
      // as it does today (stateless review).
    });
  });

  describe("stale commit handling", () => {
    it("ignores verdicts with commits not in current branch history", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const filterStaleVerdicts = mod.filterStaleVerdicts;

      const verdicts: Verdict[] = [
        {
          cycle: 1,
          commit: "abc123",
          criteria: [
            {
              file: "src/app/page.tsx",
              lineRange: "10-20",
              name: "spec-fidelity",
              status: "satisfied",
            },
          ],
          findings: [],
        },
        {
          cycle: 2,
          commit: "nonexistent",
          criteria: [
            {
              file: "src/lib/db.ts",
              lineRange: "50-60",
              name: "rls-check",
              status: "satisfied",
            },
          ],
          findings: [],
        },
      ];

      // Mock git rev-parse checking if commits exist
      const existingCommits = ["abc123"]; // "nonexistent" is missing

      const filtered = await filterStaleVerdicts(verdicts, existingCommits);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].commit).toBe("abc123");
    });
  });

  describe("verdict rewriting when all findings invalid", () => {
    it("rewrites CHANGES verdict to PASS when all findings are rejected", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const rewriteVerdictIfAllInvalid = mod.rewriteVerdictIfAllInvalid;

      const initialVerdict = `CHANGES

1. **spec-fidelity (src/app/page.tsx:10-20)**: Still wrong`;

      const validationResults: ValidationResult[] = [
        { valid: false, reason: "unchanged since cycle 1" },
      ];

      const rewritten = await rewriteVerdictIfAllInvalid(
        initialVerdict,
        validationResults,
      );

      expect(rewritten).toBe(true);
      // The verdict should now be "PASS" with a note that all findings were invalid re-raises
    });

    it("keeps CHANGES verdict when at least one finding is valid", async () => {
      const mod = await import("@/scripts/factory/qa-verdict-persistence");
      const rewriteVerdictIfAllInvalid = mod.rewriteVerdictIfAllInvalid;

      const initialVerdict = `CHANGES

1. **spec-fidelity (src/app/page.tsx:10-20)**: Still wrong
2. **rls-check (src/lib/db.ts:50-60)**: Service role key in user path`;

      const validationResults: ValidationResult[] = [
        { valid: false, reason: "unchanged since cycle 1" },
        { valid: true, reason: "new finding" },
      ];

      const rewritten = await rewriteVerdictIfAllInvalid(
        initialVerdict,
        validationResults,
      );

      expect(rewritten).toBe(false);
      // Verdict stays CHANGES because finding #2 is valid
    });
  });
});
