import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("JOBUI-2: Quote editor gets its own screen", () => {
  describe("Route structure", () => {
    it("creates the quote route page", () => {
      const quotePage = join(
        process.cwd(),
        "src",
        "app",
        "jobs",
        "[id]",
        "quote",
        "page.tsx"
      );
      expect(
        existsSync(quotePage),
        "Quote route page must exist at /jobs/[id]/quote"
      ).toBe(true);
    });

    it("preserves original editor component location", () => {
      // Critical: frozen tests 207, 443, 148 reference this exact path.
      // Moving the file breaks three frozen tests that cannot be repaired.
      const editorPath = join(
        process.cwd(),
        "src",
        "app",
        "jobs",
        "[id]",
        "quote-editor.tsx"
      );
      expect(
        existsSync(editorPath),
        "Editor component must remain at original location for frozen tests"
      ).toBe(true);
    });
  });

  describe("Job routing helper", () => {
    it("creates job-routes helper module", () => {
      const routesHelper = join(process.cwd(), "src", "lib", "job-routes.ts");
      expect(
        existsSync(routesHelper),
        "Job routes helper must exist"
      ).toBe(true);
    });

    it("exports jobQuoteHref function", async () => {
      const mod = await import("@/lib/job-routes");
      expect(
        mod.jobQuoteHref,
        "jobQuoteHref must be exported"
      ).toBeDefined();
      expect(
        typeof mod.jobQuoteHref,
        "jobQuoteHref must be a function"
      ).toBe("function");
    });

    it("jobQuoteHref returns correct path for any job ID", async () => {
      const mod = await import("@/lib/job-routes");

      // Test with different ID formats
      expect(
        mod.jobQuoteHref("job_abc123"),
        "Returns correct path for standard job ID"
      ).toBe("/jobs/job_abc123/quote");

      expect(
        mod.jobQuoteHref("job_xyz789"),
        "Returns correct path for different job ID"
      ).toBe("/jobs/job_xyz789/quote");

      expect(
        mod.jobQuoteHref("12345"),
        "Returns correct path for numeric-looking ID"
      ).toBe("/jobs/12345/quote");
    });
  });

  describe("Page modules", () => {
    it("quote route page exports default component", async () => {
      const mod = await import("@/app/jobs/[id]/quote/page");
      expect(
        mod.default,
        "Quote page must export default component"
      ).toBeDefined();
    });

    it("job page still exports default component", async () => {
      const mod = await import("@/app/jobs/[id]/page");
      expect(
        mod.default,
        "Job page must continue to export default component"
      ).toBeDefined();
    });

    it("dashboard page still exports default component", async () => {
      const mod = await import("@/app/dashboard/page");
      expect(
        mod.default,
        "Dashboard page must continue to export default component"
      ).toBeDefined();
    });
  });

  describe("Quote editor component", () => {
    it("quote editor can still be imported", async () => {
      const mod = await import("@/app/jobs/[id]/quote-editor");
      expect(
        mod.QuoteEditor,
        "QuoteEditor must remain importable at original location"
      ).toBeDefined();
    });
  });
});
