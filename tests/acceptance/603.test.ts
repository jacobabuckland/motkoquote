import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("RAIL-3: Rail-value copy — scheduling and chasing, never speed", () => {
  const scriptPath = "scripts/ci/check-forbidden-copy.sh";
  const ciWorkflowPath = ".github/workflows/ci.yml";
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for test files
    tempDir = join(process.cwd(), "tmp-test-603");
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temporary directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("CI infrastructure", () => {
    it("check-forbidden-copy.sh exists and is executable", () => {
      expect(existsSync(scriptPath)).toBe(true);

      // Check that the file is executable
      const stats = execSync(`test -x ${scriptPath} && echo "executable"`, {
        encoding: "utf-8",
      }).trim();
      expect(stats).toBe("executable");
    });

    it("CI workflow includes the forbidden-copy job", () => {
      expect(existsSync(ciWorkflowPath)).toBe(true);

      const workflowContent = execSync(`cat ${ciWorkflowPath}`, {
        encoding: "utf-8",
      });

      // The job should exist
      expect(workflowContent).toContain("forbidden-copy:");

      // It should run the check script
      expect(workflowContent).toContain(
        "bash scripts/ci/check-forbidden-copy.sh",
      );
    });
  });

  describe("Forbidden phrase detection", () => {
    it("flags 'faster payment' claim", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        export function PaymentPage() {
          return <p>Get faster payment through motko</p>;
        }
      `,
      );

      expect(() => {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
        });
      }).toThrow();
    });

    it("flags 'quicker settlement' claim", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        const copy = "Enjoy quicker settlement with our rail";
      `,
      );

      expect(() => {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
        });
      }).toThrow();
    });

    it("flags 'instant payment' claim", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        <p>Instant payment processing</p>
      `,
      );

      expect(() => {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
        });
      }).toThrow();
    });

    it("flags 'immediate settlement' claim", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        const message = "Immediate settlement of your invoices";
      `,
      );

      expect(() => {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
        });
      }).toThrow();
    });

    it("flags 'faster than bank transfer' claim", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        <p>Payment is faster than a bank transfer</p>
      `,
      );

      expect(() => {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
        });
      }).toThrow();
    });

    it("flags 'payment speed' as an advantage claim", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        <p>Benefit from improved payment speed</p>
      `,
      );

      expect(() => {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
        });
      }).toThrow();
    });

    it("flags 'quick payment' claim", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        const benefit = "Quick payment for your work";
      `,
      );

      expect(() => {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
        });
      }).toThrow();
    });

    it("flags 'rapid settlement' claim", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        return <div>Rapid settlement of funds</div>;
      `,
      );

      expect(() => {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
        });
      }).toThrow();
    });
  });

  describe("Allowed phrases", () => {
    it("allows 'automatic chasing' claim (invoice-level chasing exists)", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        export function BenefitsPage() {
          return (
            <div>
              <p>Automatic chasing of unpaid invoices</p>
              <p>Automated invoice reminders</p>
            </div>
          );
        }
      `,
      );

      const result = execSync(`bash ${scriptPath}`, {
        cwd: process.cwd(),
        env: { ...process.env, TEST_SCAN_PATH: tempDir },
        encoding: "utf-8",
      });

      expect(result).toBeTruthy(); // Should not throw
    });

    it("allows 'scheduling' as a benefit", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        <p>Better scheduling and planning for your projects</p>
      `,
      );

      const result = execSync(`bash ${scriptPath}`, {
        cwd: process.cwd(),
        env: { ...process.env, TEST_SCAN_PATH: tempDir },
        encoding: "utf-8",
      });

      expect(result).toBeTruthy(); // Should not throw
    });

    it("allows technical comments about timing", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        // The fee left with the payment, at the same instant
        const feeTimestamp = paidAt;
      `,
      );

      const result = execSync(`bash ${scriptPath}`, {
        cwd: process.cwd(),
        env: { ...process.env, TEST_SCAN_PATH: tempDir },
        encoding: "utf-8",
      });

      expect(result).toBeTruthy(); // Should not throw
    });

    it("allows unrelated uses of 'fast' (e.g., fast checkout)", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        <p>Fast and easy checkout process</p>
      `,
      );

      const result = execSync(`bash ${scriptPath}`, {
        cwd: process.cwd(),
        env: { ...process.env, TEST_SCAN_PATH: tempDir },
        encoding: "utf-8",
      });

      expect(result).toBeTruthy(); // Should not throw
    });

    it("allows unrelated uses of 'quick' (e.g., quick setup)", () => {
      const testFile = join(tempDir, "test.tsx");
      writeFileSync(
        testFile,
        `
        <p>Quick setup in minutes</p>
      `,
      );

      const result = execSync(`bash ${scriptPath}`, {
        cwd: process.cwd(),
        env: { ...process.env, TEST_SCAN_PATH: tempDir },
        encoding: "utf-8",
      });

      expect(result).toBeTruthy(); // Should not throw
    });
  });

  describe("Error reporting", () => {
    it("provides helpful error message with file path when violation is found", () => {
      const testFile = join(tempDir, "payment-page.tsx");
      writeFileSync(
        testFile,
        `
        export function PaymentPage() {
          return <p>Faster payment through our rail</p>;
        }
      `,
      );

      try {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
          encoding: "utf-8",
        });
        throw new Error("Expected script to fail but it passed");
      } catch (error: unknown) {
        const err = error as { stderr?: Buffer; stdout?: Buffer };
        const output = (
          err.stderr?.toString() ||
          err.stdout?.toString() ||
          ""
        ).toLowerCase();

        // Should mention the file path
        expect(output).toContain("payment-page.tsx");

        // Should indicate what was found
        expect(output).toMatch(/faster|speed|forbidden/);
      }
    });
  });

  describe("Real codebase scan", () => {
    it("scans src/app/ for forbidden phrases (should pass initially)", () => {
      // This test runs the script against the real codebase
      // It should pass on the current codebase which has no speed claims
      const result = execSync(`bash ${scriptPath}`, {
        cwd: process.cwd(),
        encoding: "utf-8",
      });

      expect(result).toBeTruthy(); // Should not throw
    });
  });

  describe("Edge cases", () => {
    it("passes when src/app/ is empty or does not exist", () => {
      // Test with a directory that doesn't exist
      const nonExistentDir = join(tempDir, "does-not-exist");

      const result = execSync(`bash ${scriptPath}`, {
        cwd: process.cwd(),
        env: { ...process.env, TEST_SCAN_PATH: nonExistentDir },
        encoding: "utf-8",
      });

      expect(result).toBeTruthy(); // Should not throw
    });

    it("handles multiple violations in a single file", () => {
      const testFile = join(tempDir, "multi-violations.tsx");
      writeFileSync(
        testFile,
        `
        export function Page() {
          return (
            <div>
              <p>Faster payment processing</p>
              <p>Instant settlement of invoices</p>
              <p>Quick payment turnaround</p>
            </div>
          );
        }
      `,
      );

      try {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
          encoding: "utf-8",
        });
        throw new Error("Expected script to fail but it passed");
      } catch (error: unknown) {
        // Should report all violations, not just the first
        const err = error as { stderr?: Buffer; stdout?: Buffer };
        const output =
          err.stderr?.toString() || err.stdout?.toString() || "";

        // At least one of the violations should be mentioned
        expect(output.toLowerCase()).toMatch(/faster|instant|quick/);
      }
    });

    it("handles violations across multiple files", () => {
      const file1 = join(tempDir, "page1.tsx");
      const file2 = join(tempDir, "page2.tsx");

      writeFileSync(
        file1,
        `
        <p>Faster payment through motko</p>
      `,
      );

      writeFileSync(
        file2,
        `
        <p>Instant settlement available</p>
      `,
      );

      try {
        execSync(`bash ${scriptPath}`, {
          cwd: process.cwd(),
          env: { ...process.env, TEST_SCAN_PATH: tempDir },
          encoding: "utf-8",
        });
        throw new Error("Expected script to fail but it passed");
      } catch (error: unknown) {
        const err = error as { stderr?: Buffer; stdout?: Buffer };
        const output =
          err.stderr?.toString() || err.stdout?.toString() || "";

        // Both files should be mentioned (or at least one violation is reported)
        expect(output).toBeTruthy();
      }
    });
  });
});
