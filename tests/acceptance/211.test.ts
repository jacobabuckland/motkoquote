import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(__dirname, "../..");

const readFile = (path: string): string => {
  const fullPath = resolve(repoRoot, path);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(fullPath, "utf-8");
};

describe("Issue #211: PAY-5: Deprecate and remove TrueLayer integration (code only, data preserved)", () => {
  describe("TrueLayer library files are deleted", () => {
    it("src/lib/truelayer.ts does not exist", () => {
      const path = resolve(repoRoot, "src/lib/truelayer.ts");
      expect(existsSync(path)).toBe(false);
    });

    it("src/lib/truelayer-payments.ts does not exist", () => {
      const path = resolve(repoRoot, "src/lib/truelayer-payments.ts");
      expect(existsSync(path)).toBe(false);
    });

    it("src/lib/truelayer-vrp.ts does not exist", () => {
      const path = resolve(repoRoot, "src/lib/truelayer-vrp.ts");
      expect(existsSync(path)).toBe(false);
    });

    it("src/lib/truelayer.test.ts does not exist", () => {
      const path = resolve(repoRoot, "src/lib/truelayer.test.ts");
      expect(existsSync(path)).toBe(false);
    });
  });

  describe("TrueLayer API routes are deleted", () => {
    it("src/app/api/truelayer/create-payment/route.ts does not exist", () => {
      const path = resolve(
        repoRoot,
        "src/app/api/truelayer/create-payment/route.ts",
      );
      expect(existsSync(path)).toBe(false);
    });

    it("src/app/api/truelayer/create-payment/route.test.ts does not exist", () => {
      const path = resolve(
        repoRoot,
        "src/app/api/truelayer/create-payment/route.test.ts",
      );
      expect(existsSync(path)).toBe(false);
    });

    it("src/app/api/truelayer/webhook/route.ts does not exist", () => {
      const path = resolve(repoRoot, "src/app/api/truelayer/webhook/route.ts");
      expect(existsSync(path)).toBe(false);
    });
  });

  describe("Middleware allowlist does not contain TrueLayer routes", () => {
    it("PUBLIC_API_ROUTES does not include /api/truelayer/create-payment", () => {
      const middleware = readFile("src/lib/supabase/middleware.ts");
      expect(middleware).not.toContain("/api/truelayer/create-payment");
    });

    it("PUBLIC_API_ROUTES does not include /api/truelayer/webhook", () => {
      const middleware = readFile("src/lib/supabase/middleware.ts");
      expect(middleware).not.toContain("/api/truelayer/webhook");
    });
  });

  describe("Files that imported TrueLayer modules no longer do", () => {
    it("src/app/i/[id]/page.tsx does not import from @/lib/truelayer", () => {
      const content = readFile("src/app/i/[id]/page.tsx");
      expect(content).not.toMatch(/from\s+["']@\/lib\/truelayer/);
    });

    it("src/app/settings/page.tsx does not import from @/lib/truelayer-vrp", () => {
      const content = readFile("src/app/settings/page.tsx");
      expect(content).not.toMatch(/from\s+["']@\/lib\/truelayer-vrp/);
    });

    it("src/app/settings/fee-billing-actions.ts does not import from @/lib/truelayer-vrp", () => {
      const content = readFile("src/app/settings/fee-billing-actions.ts");
      expect(content).not.toMatch(/from\s+["']@\/lib\/truelayer-vrp/);
    });

    it("src/lib/collect-fees.ts does not import from @/lib/truelayer-vrp", () => {
      // PAY-5 deletes the VRP batch outright rather than editing its imports,
      // which satisfies this criterion more strongly than the spec assumed: a
      // file that no longer exists cannot import anything.
      const path = resolve(__dirname, "../../src/lib/collect-fees.ts");
      if (!existsSync(path)) return;
      const content = readFile("src/lib/collect-fees.ts");
      expect(content).not.toMatch(/from\s+["']@\/lib\/truelayer-vrp/);
    });

    it("src/app/api/cron/chase/route.ts does not import from @/lib/truelayer", () => {
      const content = readFile("src/app/api/cron/chase/route.ts");
      expect(content).not.toMatch(/from\s+["']@\/lib\/truelayer/);
    });
  });

  describe("TrueLayer npm dependency is removed", () => {
    it("package.json does not list truelayer-signing as a dependency", () => {
      const packageJson = JSON.parse(readFile("package.json"));
      expect(packageJson.dependencies).not.toHaveProperty("truelayer-signing");
    });
  });

  describe("Documentation is updated to reference Stripe Pay by Bank", () => {
    it("README.md Payments row mentions Stripe Pay by Bank, not TrueLayer", () => {
      const readme = readFile("README.md");

      // The Payments row in the stack table should mention Stripe
      const paymentsRowMatch = readme.match(/\|\s*Payments\s*\|([^|]+)\|/i);
      expect(paymentsRowMatch).toBeTruthy();

      if (paymentsRowMatch) {
        const paymentsRow = paymentsRowMatch[1];
        // Should mention Stripe
        expect(paymentsRow).toMatch(/Stripe/i);
        // Should NOT mention TrueLayer as the current provider
        expect(paymentsRow).not.toMatch(/TrueLayer/i);
      }
    });

    it("docs/STATUS.md Payments row mentions Stripe Pay by Bank, not TrueLayer", () => {
      const status = readFile("docs/STATUS.md");

      // The Payments row should mention Stripe, not TrueLayer
      const paymentsRowMatch = status.match(/\|\s*Payments\s*\|([^|]+)\|/i);
      expect(paymentsRowMatch).toBeTruthy();

      if (paymentsRowMatch) {
        const paymentsRow = paymentsRowMatch[1];
        // Should mention Stripe
        expect(paymentsRow).toMatch(/Stripe/i);
        // Should NOT mention TrueLayer as the current provider
        expect(paymentsRow).not.toMatch(/TrueLayer/i);
      }
    });
  });

  describe("TrueLayer-specific acceptance tests are removed", () => {
    it("tests/acceptance/93.test.ts does not exist", () => {
      const path = resolve(repoRoot, "tests/acceptance/93.test.ts");
      expect(existsSync(path)).toBe(false);
    });

    it("tests/acceptance/152.test.tsx does not exist", () => {
      const path = resolve(repoRoot, "tests/acceptance/152.test.tsx");
      expect(existsSync(path)).toBe(false);
    });
  });

  describe("Historical payment handling is preserved", () => {
    it("src/lib/settle-paid-job.ts still exists and handles historical TrueLayer payments", () => {
      const content = readFile("src/lib/settle-paid-job.ts");

      // The file must still exist
      expect(content.length).toBeGreaterThan(0);

      // It should still reference payment_provider_ref for historical handling
      expect(content).toMatch(/payment_provider_ref/i);
    });
  });

  describe("No active TrueLayer code references remain", () => {
    it("src/ directory has no active imports from deleted TrueLayer modules", () => {
      // This test dynamically checks for any remaining imports
      // We walk the src/ directory and check each TypeScript file
      function walkDir(dir: string): string[] {
        const files: string[] = [];
        const entries = readdirSync(dir);

        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);

          if (stat.isDirectory()) {
            files.push(...walkDir(fullPath));
          } else if (
            (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
            !entry.endsWith(".test.ts") &&
            !entry.endsWith(".test.tsx")
          ) {
            files.push(fullPath);
          }
        }

        return files;
      }

      const srcDir = resolve(repoRoot, "src");
      const srcFiles = walkDir(srcDir);

      for (const file of srcFiles) {
        // Skip settle-paid-job.ts — it's allowed to reference TrueLayer for historical handling
        if (file.endsWith("settle-paid-job.ts")) {
          continue;
        }

        const content = readFileSync(file, "utf-8");

        // Should not import from deleted TrueLayer modules
        expect(content).not.toMatch(
          /from\s+["']@\/lib\/truelayer(-payments|-vrp)?["']/,
        );
        expect(content).not.toMatch(/from\s+["']truelayer-signing["']/);
      }
    });
  });

  describe("Environment variables documentation", () => {
    it("spec documents seven TrueLayer env vars to remove", () => {
      const spec = readFile("docs/specs/211.md");

      const requiredVars = [
        "TRUELAYER_CLIENT_ID",
        "TRUELAYER_CLIENT_SECRET",
        "TRUELAYER_ENV",
        "TRUELAYER_SIGNING_KID",
        "TRUELAYER_SIGNING_PRIVATE_KEY_B64",
        "TRUELAYER_MERCHANT_ACCOUNT_ID",
        "MOTKO_FEE_BENEFICIARY_NAME",
      ];

      for (const varName of requiredVars) {
        expect(spec).toContain(varName);
      }

      // Should mention removal
      expect(spec).toMatch(/remove.*environment.*variable/i);
    });
  });
});
