import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, accessSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Absolute, because every invocation below runs the script with `cwd` set to a
// temp directory standing in for a repo root. A repo-relative path resolves
// against that temp cwd, where the script does not exist — so bash exits with
// "No such file or directory" no matter what the script does.
const CHECK_SCRIPT = resolve(process.cwd(), "scripts/ci/check-spec-citations.sh");

describe("DOCS-2: Citation check in CI", () => {
  it("the check script exists and is executable", () => {
    const scriptPath = "scripts/ci/check-spec-citations.sh";
    expect(existsSync(scriptPath)).toBe(true);

    // Verify it's executable
    expect(() => {
      accessSync(scriptPath, constants.X_OK);
    }).not.toThrow();
  });

  it("fails when a spec cites a missing document", () => {
    // Create a temporary directory with a spec that cites a missing file
    const tempDir = mkdtempSync(join(tmpdir(), "spec-citations-test-"));
    const specsDir = join(tempDir, "docs", "specs");
    const fakeRoot = tempDir;

    try {
      // Create the directory structure
      execFileSync("mkdir", ["-p", specsDir]);

      // Write a spec with a broken citation
      const specPath = join(specsDir, "test-spec.md");
      writeFileSync(
        specPath,
        "# Test Spec\n\nSee `docs/missing-document.md` for details.\n",
      );

      // Run the check script against the temporary directory
      // It should fail (non-zero exit) because missing-document.md doesn't exist
      expect(() => {
        execFileSync("bash", [CHECK_SCRIPT], {
          cwd: fakeRoot,
          encoding: "utf-8",
        });
      }).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("passes when all citations resolve", () => {
    // Create a temporary directory with a spec that cites an existing file
    const tempDir = mkdtempSync(join(tmpdir(), "spec-citations-test-"));
    const specsDir = join(tempDir, "docs", "specs");
    const docsDir = join(tempDir, "docs");

    try {
      // Create the directory structure
      execFileSync("mkdir", ["-p", specsDir]);

      // Write the referenced document first
      const referencedPath = join(docsDir, "existing-document.md");
      writeFileSync(referencedPath, "# Existing Document\n\nContent here.\n");

      // Write a spec that cites the existing document
      const specPath = join(specsDir, "test-spec.md");
      writeFileSync(
        specPath,
        "# Test Spec\n\nSee `docs/existing-document.md` for details.\n",
      );

      // Run the check script against the temporary directory
      // It should pass (exit 0) because existing-document.md exists
      const result = execFileSync(
        "bash",
        [CHECK_SCRIPT],
        {
          cwd: tempDir,
          encoding: "utf-8",
        },
      );

      expect(result).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ignores prose references without backticks", () => {
    // Create a temporary directory with a spec that mentions a file without backticks
    const tempDir = mkdtempSync(join(tmpdir(), "spec-citations-test-"));
    const specsDir = join(tempDir, "docs", "specs");

    try {
      // Create the directory structure
      execFileSync("mkdir", ["-p", specsDir]);

      // Write a spec that mentions a file in prose (no backticks)
      // The file doesn't exist, but the check should pass because it's not backticked
      const specPath = join(specsDir, "test-spec.md");
      writeFileSync(
        specPath,
        "# Test Spec\n\nSee the document nonexistent-file.md for more information.\n",
      );

      // Run the check script against the temporary directory
      // It should pass because prose references are out of scope
      const result = execFileSync(
        "bash",
        [CHECK_SCRIPT],
        {
          cwd: tempDir,
          encoding: "utf-8",
        },
      );

      expect(result).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("names the unresolved path when a citation fails", () => {
    // Create a temporary directory with a spec that cites a missing file
    const tempDir = mkdtempSync(join(tmpdir(), "spec-citations-test-"));
    const specsDir = join(tempDir, "docs", "specs");

    try {
      // Create the directory structure
      execFileSync("mkdir", ["-p", specsDir]);

      // Write a spec with a broken citation to a specific missing file
      const specPath = join(specsDir, "test-spec.md");
      const missingPath = "docs/specifications/critical-doc.md";
      writeFileSync(
        specPath,
        `# Test Spec\n\nRefer to \`${missingPath}\` for the requirements.\n`,
      );

      // Run the check script and capture the output
      let output = "";
      try {
        execFileSync("bash", [CHECK_SCRIPT], {
          cwd: tempDir,
          encoding: "utf-8",
        });
      } catch (error: unknown) {
        if (
          error &&
          typeof error === "object" &&
          "stderr" in error &&
          typeof error.stderr === "string"
        ) {
          output = error.stderr;
        }
        if (
          error &&
          typeof error === "object" &&
          "stdout" in error &&
          typeof error.stdout === "string"
        ) {
          output += error.stdout;
        }
      }

      // The output should name the missing path
      expect(output).toContain(missingPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("extracts citations from multiple spec files", () => {
    // Create a temporary directory with multiple specs
    const tempDir = mkdtempSync(join(tmpdir(), "spec-citations-test-"));
    const specsDir = join(tempDir, "docs", "specs");
    const docsDir = join(tempDir, "docs");

    try {
      // Create the directory structure
      execFileSync("mkdir", ["-p", specsDir]);

      // Write a referenced document
      const referencedPath = join(docsDir, "shared-doc.md");
      writeFileSync(referencedPath, "# Shared Document\n");

      // Write multiple specs that cite it
      const spec1Path = join(specsDir, "spec-one.md");
      writeFileSync(
        spec1Path,
        "# Spec One\n\nSee `docs/shared-doc.md`.\n",
      );

      const spec2Path = join(specsDir, "spec-two.md");
      writeFileSync(
        spec2Path,
        "# Spec Two\n\nAlso see `docs/shared-doc.md`.\n",
      );

      // Run the check script
      // It should pass because the referenced document exists
      const result = execFileSync(
        "bash",
        [CHECK_SCRIPT],
        {
          cwd: tempDir,
          encoding: "utf-8",
        },
      );

      expect(result).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("checks against the repository root, not relative to the spec", () => {
    // Create a temporary directory where a path is ambiguous
    const tempDir = mkdtempSync(join(tmpdir(), "spec-citations-test-"));
    const specsDir = join(tempDir, "docs", "specs");
    const docsDir = join(tempDir, "docs");

    try {
      // Create the directory structure
      execFileSync("mkdir", ["-p", specsDir]);

      // Write a document at docs/reference.md
      const referencedPath = join(docsDir, "reference.md");
      writeFileSync(referencedPath, "# Reference\n");

      // Write a spec that cites it as `docs/reference.md` (absolute from repo root)
      const specPath = join(specsDir, "test-spec.md");
      writeFileSync(specPath, "# Test\n\nSee `docs/reference.md`.\n");

      // Run the check script
      // It should pass because docs/reference.md exists relative to repo root
      const result = execFileSync(
        "bash",
        [CHECK_SCRIPT],
        {
          cwd: tempDir,
          encoding: "utf-8",
        },
      );

      expect(result).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("recognizes citations in various quote styles", () => {
    // Create a temporary directory
    const tempDir = mkdtempSync(join(tmpdir(), "spec-citations-test-"));
    const specsDir = join(tempDir, "docs", "specs");
    const docsDir = join(tempDir, "docs");

    try {
      // Create the directory structure
      execFileSync("mkdir", ["-p", specsDir]);

      // Write the referenced documents
      const doc1 = join(docsDir, "doc-one.md");
      const doc2 = join(docsDir, "doc-two.md");
      const doc3 = join(docsDir, "doc-three.md");
      writeFileSync(doc1, "# Doc One\n");
      writeFileSync(doc2, "# Doc Two\n");
      writeFileSync(doc3, "# Doc Three\n");

      // Write a spec with various quote styles
      const specPath = join(specsDir, "test-spec.md");
      writeFileSync(
        specPath,
        [
          "# Test Spec",
          "",
          "Backticks: `docs/doc-one.md`",
          "Double quotes: `docs/doc-two.md`",
          "Single quotes: `docs/doc-three.md`",
          "",
        ].join("\n"),
      );

      // Run the check script
      // It should pass because all three documents exist
      const result = execFileSync(
        "bash",
        [CHECK_SCRIPT],
        {
          cwd: tempDir,
          encoding: "utf-8",
        },
      );

      expect(result).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("the CI workflow includes the citation check", async () => {
    // Read the CI workflow file
    const { readFileSync } = await import("node:fs");
    const workflowPath = ".github/workflows/ci.yml";
    const workflow = readFileSync(workflowPath, "utf-8");

    // Verify the check-spec-citations script is invoked
    expect(workflow).toContain("check-spec-citations");
  });
});
