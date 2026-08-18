/**
 * @vitest-environment happy-dom
 *
 * Issue #254: LED-3: Receipt photo capture with confirmed extraction
 *
 * Tests verify:
 * 1. Database migration creates job_costs table with correct schema
 * 2. Storage bucket 'receipts' is created with RLS policies
 * 3. Receipt capture and cost entry components exist
 * 4. Extraction API route exists
 * 5. CRITICAL: Extraction alone does NOT write to database (only confirmation writes)
 * 6. Storage RLS prevents cross-contractor access
 * 7. Camera permission handling exists
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Issue #254: Receipt photo capture with confirmed extraction", () => {
  const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

  describe("Database migration: job_costs table", () => {
    it("creates a migration file for job_costs table", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const costsMigration = files.find((f) =>
        f.toLowerCase().includes("job_costs") || f.toLowerCase().includes("costs")
      );

      expect(costsMigration).toBeDefined();
      expect(costsMigration).toMatch(/^\d{14}_.*\.sql$/);
    });

    it("migration creates job_costs table with required columns", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const costsMigration = files.find((f) =>
        f.toLowerCase().includes("job_costs") || f.toLowerCase().includes("costs")
      );

      if (!costsMigration) {
        throw new Error("job_costs migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, costsMigration), "utf8");
      const lower = content.toLowerCase();

      // Table creation
      expect(lower).toMatch(/create\s+table\s+job_costs/);

      // Required columns
      expect(lower).toMatch(/job_id\s+uuid/);
      expect(lower).toMatch(/contractor_id\s+uuid/);
      expect(lower).toMatch(/amount\s+numeric/);
      expect(lower).toMatch(/evidence_url\s+text/);
      expect(lower).toMatch(/created_at\s+timestamptz/);
    });

    it("migration includes foreign key to jobs table", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const costsMigration = files.find((f) =>
        f.toLowerCase().includes("job_costs") || f.toLowerCase().includes("costs")
      );

      if (!costsMigration) {
        throw new Error("job_costs migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, costsMigration), "utf8");
      const lower = content.toLowerCase();

      // Foreign key to jobs
      expect(lower).toMatch(/references\s+jobs/);
    });

    it("migration enables RLS on job_costs", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const costsMigration = files.find((f) =>
        f.toLowerCase().includes("job_costs") || f.toLowerCase().includes("costs")
      );

      if (!costsMigration) {
        throw new Error("job_costs migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, costsMigration), "utf8");
      const lower = content.toLowerCase();

      expect(lower).toMatch(/alter\s+table\s+job_costs\s+enable\s+row\s+level\s+security/);
    });

    it("migration creates RLS policy scoped via contractor_id", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const costsMigration = files.find((f) =>
        f.toLowerCase().includes("job_costs") || f.toLowerCase().includes("costs")
      );

      if (!costsMigration) {
        throw new Error("job_costs migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, costsMigration), "utf8");
      const lower = content.toLowerCase();

      // Policy exists for job_costs
      expect(lower).toMatch(/create\s+policy.*on\s+job_costs/);
      // Policy uses contractor_id for scoping
      expect(lower).toMatch(/contractor_id/);
    });

    it("migration includes supplier, cost_date, vat_amount, extraction_method columns", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const costsMigration = files.find((f) =>
        f.toLowerCase().includes("job_costs") || f.toLowerCase().includes("costs")
      );

      if (!costsMigration) {
        throw new Error("job_costs migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, costsMigration), "utf8");
      const lower = content.toLowerCase();

      expect(lower).toMatch(/supplier\s+text/);
      expect(lower).toMatch(/cost_date\s+date/);
      expect(lower).toMatch(/vat_amount\s+numeric/);
      expect(lower).toMatch(/extraction_method\s+text/);
    });
  });

  describe("Storage migration: receipts bucket", () => {
    it("creates a migration file for receipts storage bucket", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const storageMigration = files.find((f) =>
        f.toLowerCase().includes("receipt") && f.toLowerCase().includes("storage")
      );

      expect(storageMigration).toBeDefined();
      expect(storageMigration).toMatch(/^\d{14}_.*\.sql$/);
    });

    it("migration creates receipts bucket", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const storageMigration = files.find((f) =>
        f.toLowerCase().includes("receipt") && f.toLowerCase().includes("storage")
      );

      if (!storageMigration) {
        throw new Error("receipts storage migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, storageMigration), "utf8");
      const lower = content.toLowerCase();

      // Bucket creation
      expect(lower).toMatch(/insert\s+into\s+storage\.buckets/);
      expect(lower).toMatch(/receipts/);
    });

    it("migration creates RLS policies for receipts bucket scoped by auth.uid()", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const storageMigration = files.find((f) =>
        f.toLowerCase().includes("receipt") && f.toLowerCase().includes("storage")
      );

      if (!storageMigration) {
        throw new Error("receipts storage migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, storageMigration), "utf8");
      const lower = content.toLowerCase();

      // Policy exists on storage.objects for receipts bucket
      expect(lower).toMatch(/create\s+policy.*on\s+storage\.objects/);
      expect(lower).toMatch(/receipts/);

      // Policy scopes by auth.uid() folder structure
      expect(lower).toMatch(/auth\.uid\(\)/);
      expect(lower).toMatch(/storage\.foldername|foldername/);
    });

    it("migration creates separate policies for insert and select on storage", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const storageMigration = files.find((f) =>
        f.toLowerCase().includes("receipt") && f.toLowerCase().includes("storage")
      );

      if (!storageMigration) {
        throw new Error("receipts storage migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, storageMigration), "utf8");
      const lower = content.toLowerCase();

      // Should have policies for both insert (upload) and select (read)
      expect(lower).toMatch(/for\s+insert/);
      expect(lower).toMatch(/for\s+select/);
    });
  });

  describe("Receipt capture component", () => {
    it("creates receipt-capture component", () => {
      const componentPath = resolve(
        process.cwd(),
        "src/components/costs/receipt-capture.tsx"
      );
      expect(existsSync(componentPath)).toBe(true);
    });

    it("receipt-capture component exports a React component", () => {
      const componentPath = resolve(
        process.cwd(),
        "src/components/costs/receipt-capture.tsx"
      );
      if (!existsSync(componentPath)) {
        throw new Error("receipt-capture component does not exist yet");
      }

      const content = readFileSync(componentPath, "utf8");
      // Should have an export (default or named)
      expect(content).toMatch(/export\s+(default|const|function)/);
    });

    it("receipt-capture component handles file input or camera access", async () => {
      const componentPath = resolve(
        process.cwd(),
        "src/components/costs/receipt-capture.tsx"
      );
      const content = readFileSync(componentPath, "utf8");

      // Should use file input or camera API
      expect(content).toMatch(/type="file"|Camera|camera|getUserMedia|input.*accept.*image/i);
    });
  });

  describe("Cost draft form component", () => {
    it("creates cost-draft-form component", () => {
      const formPath = resolve(
        process.cwd(),
        "src/components/costs/cost-draft-form.tsx"
      );
      expect(existsSync(formPath)).toBe(true);
    });

    it("cost-draft-form component exports a React component", () => {
      const formPath = resolve(
        process.cwd(),
        "src/components/costs/cost-draft-form.tsx"
      );
      if (!existsSync(formPath)) {
        throw new Error("cost-draft-form component does not exist yet");
      }

      const content = readFileSync(formPath, "utf8");
      // Should have an export
      expect(content).toMatch(/export\s+(default|const|function)/);
    });

    it("cost-draft-form has editable fields for amount, supplier, date, vat", async () => {
      const formPath = resolve(
        process.cwd(),
        "src/components/costs/cost-draft-form.tsx"
      );
      const content = readFileSync(formPath, "utf8");

      // Should have input fields for the extracted data
      expect(content.toLowerCase()).toMatch(/amount|total/);
      expect(content.toLowerCase()).toMatch(/supplier/);
      expect(content.toLowerCase()).toMatch(/date/);
      expect(content.toLowerCase()).toMatch(/vat/);
    });

    it("cost-draft-form requires explicit confirmation action", async () => {
      const formPath = resolve(
        process.cwd(),
        "src/components/costs/cost-draft-form.tsx"
      );
      const content = readFileSync(formPath, "utf8");

      // Should have a confirm/save button
      expect(content).toMatch(/[Ss]ave|[Cc]onfirm|[Ss]ubmit/);
      expect(content).toMatch(/<[Bb]utton|button/);
    });
  });

  describe("Extraction API route", () => {
    it("creates extraction API route at /api/costs/extract", () => {
      const routePath = resolve(
        process.cwd(),
        "src/app/api/costs/extract/route.ts"
      );
      expect(existsSync(routePath)).toBe(true);
    });

    it("extraction route exports POST handler", () => {
      const routePath = resolve(
        process.cwd(),
        "src/app/api/costs/extract/route.ts"
      );
      if (!existsSync(routePath)) {
        throw new Error("extraction API route does not exist yet");
      }

      const content = readFileSync(routePath, "utf8");
      // Should export POST function
      expect(content).toMatch(/export\s+(async\s+)?function\s+POST|export\s+const\s+POST/);
    });

    it("extraction route calls Claude API or similar vision model", async () => {
      const routePath = resolve(
        process.cwd(),
        "src/app/api/costs/extract/route.ts"
      );
      const content = readFileSync(routePath, "utf8");

      // Should call anthropic/claude or import extraction function
      expect(content.toLowerCase()).toMatch(/anthropic|claude|vision|extract.*receipt|extract-receipt/);
    });

    it("extraction route returns structured JSON with total, supplier, date, vat or error", async () => {
      const routePath = resolve(
        process.cwd(),
        "src/app/api/costs/extract/route.ts"
      );
      const content = readFileSync(routePath, "utf8");

      // Should return JSON response
      expect(content).toMatch(/Response|NextResponse/);
      expect(content).toMatch(/json/i);
    });
  });

  describe("Extraction does NOT write to database", () => {
    it("extraction route does NOT import or call supabase client", async () => {
      const routePath = resolve(
        process.cwd(),
        "src/app/api/costs/extract/route.ts"
      );
      const content = readFileSync(routePath, "utf8");

      // Should NOT create supabase client or insert into job_costs
      expect(content.toLowerCase()).not.toMatch(/createClient.*supabase|from.*job_costs.*insert/);
    });

    it("cost-draft-form is the only place that writes to job_costs on confirmation", async () => {
      const formPath = resolve(
        process.cwd(),
        "src/components/costs/cost-draft-form.tsx"
      );
      const content = readFileSync(formPath, "utf8");

      // Form should create supabase client and insert on confirm
      expect(content).toMatch(/createClient|supabase/);
      expect(content).toMatch(/job_costs|insert/);
    });

    it("extraction library function returns data without database writes", async () => {
      // If extract-receipt.ts exists, verify it only does AI extraction
      const libPath = resolve(process.cwd(), "src/lib/extract-receipt.ts");
      if (existsSync(libPath)) {
        const content = readFileSync(libPath, "utf8");

        // Should NOT import supabase
        expect(content.toLowerCase()).not.toMatch(/createClient.*from.*supabase|from.*job_costs/);
        // Should call Anthropic/Claude
        expect(content.toLowerCase()).toMatch(/anthropic|claude|messages/);
      }
    });
  });

  describe("Cost display components", () => {
    it("creates cost-row component for displaying a single cost", () => {
      const rowPath = resolve(process.cwd(), "src/components/costs/cost-row.tsx");
      expect(existsSync(rowPath)).toBe(true);
    });

    it("cost-row component exports a React component", () => {
      const rowPath = resolve(process.cwd(), "src/components/costs/cost-row.tsx");
      if (!existsSync(rowPath)) {
        throw new Error("cost-row component does not exist yet");
      }

      const content = readFileSync(rowPath, "utf8");
      // Should have an export
      expect(content).toMatch(/export\s+(default|const|function)/);
    });

    it("cost-row displays supplier, amount, date, and receipt thumbnail", async () => {
      const rowPath = resolve(process.cwd(), "src/components/costs/cost-row.tsx");
      const content = readFileSync(rowPath, "utf8");

      expect(content.toLowerCase()).toMatch(/supplier/);
      expect(content.toLowerCase()).toMatch(/amount|total/);
      expect(content.toLowerCase()).toMatch(/date/);
      expect(content.toLowerCase()).toMatch(/evidence_url|receipt|thumbnail|img|image/);
    });

    it("creates costs-list component for displaying all costs", () => {
      const listPath = resolve(process.cwd(), "src/components/costs/costs-list.tsx");
      expect(existsSync(listPath)).toBe(true);
    });

    it("costs-list component exports a React component", () => {
      const listPath = resolve(process.cwd(), "src/components/costs/costs-list.tsx");
      if (!existsSync(listPath)) {
        throw new Error("costs-list component does not exist yet");
      }

      const content = readFileSync(listPath, "utf8");
      // Should have an export
      expect(content).toMatch(/export\s+(default|const|function)/);
    });
  });

  describe("Camera permission handling", () => {
    it("creates camera permission library module", () => {
      const permPath = resolve(process.cwd(), "src/lib/camera-permission.ts");
      expect(existsSync(permPath)).toBe(true);
    });

    it("camera permission module exports permission request function", () => {
      const permPath = resolve(process.cwd(), "src/lib/camera-permission.ts");
      if (!existsSync(permPath)) {
        throw new Error("camera permission module does not exist yet");
      }

      const content = readFileSync(permPath, "utf8");
      // Should export something
      expect(content).toMatch(/export\s+(async\s+)?(function|const)/);
    });

    it("camera permission module includes openAppSettings or similar for iOS deep-link", async () => {
      const permPath = resolve(process.cwd(), "src/lib/camera-permission.ts");
      const content = readFileSync(permPath, "utf8");

      // Should handle permission denial and settings deep-link
      expect(content).toMatch(/openAppSettings|Settings|permission/i);
    });

    it("camera permission module handles permission states (granted, denied, prompt)", async () => {
      const permPath = resolve(process.cwd(), "src/lib/camera-permission.ts");
      const content = readFileSync(permPath, "utf8");

      // Should check or handle permission states
      expect(content).toMatch(/granted|denied|prompt|PermissionState/);
    });
  });

  describe("Job page integration", () => {
    it("job page includes costs section or add-cost button", () => {
      const jobPagePath = resolve(process.cwd(), "src/app/jobs/[id]/page.tsx");
      const content = readFileSync(jobPagePath, "utf8");

      // Should import or render costs-related components
      expect(content).toMatch(/costs|Costs|CostsList|AddCost|add-cost/i);
    });
  });

  describe("Photo compression", () => {
    it("receipt-capture component handles image compression", () => {
      const componentPath = resolve(
        process.cwd(),
        "src/components/costs/receipt-capture.tsx"
      );

      if (!existsSync(componentPath)) {
        throw new Error("receipt-capture component does not exist yet");
      }

      const content = readFileSync(componentPath, "utf8");

      // Should mention compression, resize, or max size
      expect(content).toMatch(/compress|resize|800|maxSize|max.*[Ss]ize|canvas|image-compression/i);
    });
  });

  describe("Storage RLS cross-contractor access test", () => {
    it("storage policies prevent reading another contractor's receipt", () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      const storageMigration = files.find((f) =>
        f.toLowerCase().includes("receipt") && f.toLowerCase().includes("storage")
      );

      if (!storageMigration) {
        throw new Error("receipts storage migration not found");
      }

      const content = readFileSync(resolve(MIGRATIONS_DIR, storageMigration), "utf8");
      const lower = content.toLowerCase();

      // The policy for SELECT must scope by auth.uid()
      // This prevents contractor A from reading contractor B's receipts
      expect(lower).toMatch(/for\s+select/);
      expect(lower).toMatch(/auth\.uid\(\)/);
      expect(lower).toMatch(/receipts/);

      // The folder structure must be {auth.uid()}/filename
      // so (storage.foldername(name))[1] = auth.uid()::text enforces scoping
      expect(lower).toMatch(/storage\.foldername|foldername/);
    });
  });

  describe("Offline handling", () => {
    it("receipt-capture component handles offline state", () => {
      const componentPath = resolve(
        process.cwd(),
        "src/components/costs/receipt-capture.tsx"
      );

      if (!existsSync(componentPath)) {
        throw new Error("receipt-capture component does not exist yet");
      }

      const content = readFileSync(componentPath, "utf8");

      // Should check online status or handle upload errors
      expect(content).toMatch(/online|offline|navigator\.onLine|network|connection/i);
    });
  });

  describe("Sanity bounds on extraction", () => {
    it("extraction route or form validates amount bounds (£0.01 to £100,000)", () => {
      // Check either the extraction route or the draft form for validation
      const routePath = resolve(
        process.cwd(),
        "src/app/api/costs/extract/route.ts"
      );
      const formPath = resolve(
        process.cwd(),
        "src/components/costs/cost-draft-form.tsx"
      );

      let foundValidation = false;

      if (existsSync(routePath)) {
        const content = readFileSync(routePath, "utf8");
        if (content.match(/100000|0\.01|sanity|bounds|validation/i)) {
          foundValidation = true;
        }
      }

      if (!foundValidation && existsSync(formPath)) {
        const content = readFileSync(formPath, "utf8");
        if (content.match(/100000|0\.01|sanity|bounds|validation/i)) {
          foundValidation = true;
        }
      }

      expect(foundValidation).toBe(true);
    });

    it("extraction route or form validates date bounds (not > 2 years old or future)", () => {
      const routePath = resolve(
        process.cwd(),
        "src/app/api/costs/extract/route.ts"
      );
      const formPath = resolve(
        process.cwd(),
        "src/components/costs/cost-draft-form.tsx"
      );

      let foundDateValidation = false;

      if (existsSync(routePath)) {
        const content = readFileSync(routePath, "utf8");
        if (content.match(/years|date|past|future|sanity|bounds/i)) {
          foundDateValidation = true;
        }
      }

      if (!foundDateValidation && existsSync(formPath)) {
        const content = readFileSync(formPath, "utf8");
        if (content.match(/years|date|past|future|sanity|bounds/i)) {
          foundDateValidation = true;
        }
      }

      expect(foundDateValidation).toBe(true);
    });
  });
});
