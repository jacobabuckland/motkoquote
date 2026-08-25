/**
 * @vitest-environment happy-dom
 *
 * Acceptance tests for Issue #309: Apply disclosure to the Business page sections
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { mockNativePlatform, mockCapacitorPlugins } from "../helpers/capacitor";

afterEach(cleanup);

describe("Issue #309: Apply disclosure to the Business page sections", () => {
  describe("SetupForm structure", () => {
    it("imports Disclosure component", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Should import Disclosure
      expect(source).toContain("Disclosure");
      expect(source).toMatch(/import.*Disclosure.*from.*@\/components\/ui\/disclosure/);
    });

    it("wraps Company section in Disclosure", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Company section should be wrapped
      expect(source).toMatch(/<Disclosure[^>]*id=["']setup-company["']/);
      expect(source).toMatch(/<Disclosure[^>]*title=["']Company["']/);
    });

    it("wraps Rates section in Disclosure", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Rates section should be wrapped
      expect(source).toMatch(/<Disclosure[^>]*id=["']setup-rates["']/);
      expect(source).toMatch(/<Disclosure[^>]*title=["']Rates["']/);
    });

    it("wraps Team section in Disclosure", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Team section should be wrapped
      expect(source).toMatch(/<Disclosure[^>]*id=["']setup-team["']/);
      expect(source).toMatch(/<Disclosure[^>]*title=["']Team["']/);
    });

    it("wraps Merchants section in Disclosure", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Merchants section should be wrapped
      expect(source).toMatch(/<Disclosure[^>]*id=["']setup-merchants["']/);
      expect(source).toMatch(/<Disclosure[^>]*title=["']Merchants/);
    });

    it("wraps Legal section in Disclosure", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Legal section should be wrapped
      expect(source).toMatch(/<Disclosure[^>]*id=["']setup-legal["']/);
      expect(source).toMatch(/<Disclosure[^>]*title=["']Legal/);
    });

    it("wraps Branding section in Disclosure", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Branding section should be wrapped
      expect(source).toMatch(/<Disclosure[^>]*id=["']setup-branding["']/);
      expect(source).toMatch(/<Disclosure[^>]*title=["'].*[Bb]randing/);
    });
  });

  describe("Default states", () => {
    it("all six sections have defaultOpen={false}", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Each of the six sections should have defaultOpen={false}
      const sectionIds = [
        "setup-company",
        "setup-rates",
        "setup-team",
        "setup-merchants",
        "setup-legal",
        "setup-branding",
      ];

      for (const id of sectionIds) {
        const disclosureMatch = source.match(
          new RegExp(`<Disclosure[^>]*id=["']${id}["'][^>]*>`, "s")
        );
        expect(disclosureMatch).toBeTruthy();

        if (disclosureMatch) {
          const match = disclosureMatch[0];
          // Should have defaultOpen={false}
          expect(match).toMatch(/defaultOpen={false}/);
        }
      }
    });

    it("no section has defaultOpen={true}", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Should not have any defaultOpen={true} in the file
      const trueDefaults = source.match(/defaultOpen={true}/g) || [];
      expect(trueDefaults.length).toBe(0);
    });
  });

  // Renamed from "Out of scope sections": both are now IN scope, by owner
  // decision on 2026-08-25 reversing #309's original scoping.
  describe("Sections nested by the 25 Aug regrouping", () => {
    it("VAT sits INSIDE the Company disclosure", async () => {
      // INVERTED on 2026-08-25 by owner decision. #309 deliberately scoped VAT
      // out, and this asserted it stayed out. The setup screen then read as a
      // mix of tidy collapsed rows and loose content between them: Company >
      // collapsed, then a bare VAT checkbox and text field, then Rates >. VAT
      // is company information and belongs in the Company section.
      //
      // What was here before could not have caught the move anyway. It sliced
      // the section out with /<section[^>]*>[\s\S]*?VAT[\s\S]*?<\/section>/,
      // and `[\s\S]*?` crosses anything — the match began at the FIRST
      // <section> in the file — then guarded the assertion behind `if
      // (vatSectionMatch)`, so a non-match passed silently. Tag balance is the
      // actual claim, and it is the same shape the Rate cards test below was
      // already repaired to use.
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Located by the heading's own markup rather than by an indented string:
      // a leading-whitespace match silently stops finding the heading the
      // moment nesting depth or formatting changes, and indexOf's -1 then
      // slices the WHOLE file, which happens to fail here for a reason that has
      // nothing to do with the claim.
      const at = source.search(/<h2[^>]*>\s*VAT\s*<\/h2>/);
      expect(at, "VAT heading not found in setup-form.tsx").toBeGreaterThan(-1);
      const beforeVat = source.slice(0, at);
      const opened = (beforeVat.match(/<Disclosure[\s>]/g) ?? []).length;
      const closed = (beforeVat.match(/<\/Disclosure>/g) ?? []).length;

      // One Disclosure open and unclosed at the heading = VAT is nested in it.
      expect(
        opened - closed,
        "VAT must sit inside the Company disclosure, not loose between sections"
      ).toBe(1);
    });

    it("Rate cards sits INSIDE the Rates disclosure", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Rate cards section h2 should exist but NOT be inside a Disclosure
      expect(source).toContain("Rate cards");

      // Rate cards must sit INSIDE the Rates disclosure.
      //
      // INVERTED on 2026-08-25 by owner decision. #309 scoped Rate cards out
      // and this asserted it stayed out. It was not merely unwrapped: it sat
      // AFTER the Team disclosure closed, so it was separated from Rates by a
      // whole other section. It has moved, not just been wrapped.
      //
      // The tag-balance mechanism is kept exactly as it was — it is the
      // repaired form, and the reason it is right is unchanged. Only the
      // expected number differs: an unclosed Disclosure at the heading means
      // the heading is nested inside one.
      // See the note on the VAT test above: anchored on the heading markup so
      // this cannot pass or fail on indentation.
      const at = source.search(/<h2[^>]*>\s*Rate cards\s*<\/h2>/);
      expect(at, "Rate cards heading not found in setup-form.tsx").toBeGreaterThan(-1);
      const beforeRateCards = source.slice(0, at);
      const opened = (beforeRateCards.match(/<Disclosure[\s>]/g) ?? []).length;
      const closed = (beforeRateCards.match(/<\/Disclosure>/g) ?? []).length;

      expect(
        opened - closed,
        "Rate cards must sit inside the Rates disclosure"
      ).toBe(1);
    });
  });

  describe("Section IDs are stable and unique", () => {
    it("each section has a unique disclosure ID", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      const expectedIds = [
        "setup-company",
        "setup-rates",
        "setup-team",
        "setup-merchants",
        "setup-legal",
        "setup-branding",
      ];

      for (const id of expectedIds) {
        // Each ID should appear exactly once
        const matches = source.match(new RegExp(`id=["']${id}["']`, "g")) || [];
        expect(matches.length).toBe(1);
      }
    });
  });

  describe("Persistence", () => {
    beforeEach(() => {
      vi.resetModules();
      if (typeof window !== "undefined") {
        window.localStorage.clear();
      }
      mockNativePlatform(false);
      mockCapacitorPlugins();
    });

    it("a contractor who opens Rates finds it open on next mount", async () => {
      // Pre-populate localStorage as if contractor opened Rates
      window.localStorage.setItem("motko.disclosure.setup-rates", "open");

      const { Disclosure } = await import("@/components/ui/disclosure");

      render(
        <Disclosure id="setup-rates" title="Rates" defaultOpen={false}>
          <div data-testid="rates-content">Day rate, overtime...</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Rates/i });

      // Should be open (overriding defaultOpen={false}) because localStorage says so
      expect(header.getAttribute("aria-expanded")).toBe("true");
    });

    it("sections persist independently", async () => {
      // Open two sections
      window.localStorage.setItem("motko.disclosure.setup-company", "open");
      window.localStorage.setItem("motko.disclosure.setup-team", "open");
      // Leave rates closed
      window.localStorage.setItem("motko.disclosure.setup-rates", "closed");

      const { Disclosure } = await import("@/components/ui/disclosure");

      render(
        <>
          <Disclosure id="setup-company" title="Company" defaultOpen={false}>
            <div>Company content</div>
          </Disclosure>
          <Disclosure id="setup-rates" title="Rates" defaultOpen={false}>
            <div>Rates content</div>
          </Disclosure>
          <Disclosure id="setup-team" title="Team" defaultOpen={false}>
            <div>Team content</div>
          </Disclosure>
        </>
      );

      const companyHeader = screen.getByRole("button", { name: /Company/i });
      const ratesHeader = screen.getByRole("button", { name: /Rates/i });
      const teamHeader = screen.getByRole("button", { name: /Team/i });

      // Company and Team should be open, Rates should be closed
      expect(companyHeader.getAttribute("aria-expanded")).toBe("true");
      expect(ratesHeader.getAttribute("aria-expanded")).toBe("false");
      expect(teamHeader.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("Independent toggling", () => {
    beforeEach(() => {
      vi.resetModules();
      if (typeof window !== "undefined") {
        window.localStorage.clear();
      }
      mockNativePlatform(false);
      mockCapacitorPlugins();
    });

    it("opening one section does not close others", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");

      render(
        <>
          <Disclosure id="setup-company" title="Company" defaultOpen={false}>
            <div>Company content</div>
          </Disclosure>
          <Disclosure id="setup-rates" title="Rates" defaultOpen={false}>
            <div>Rates content</div>
          </Disclosure>
          <Disclosure id="setup-team" title="Team" defaultOpen={false}>
            <div>Team content</div>
          </Disclosure>
        </>
      );

      const companyHeader = screen.getByRole("button", { name: /Company/i });
      const ratesHeader = screen.getByRole("button", { name: /Rates/i });
      const teamHeader = screen.getByRole("button", { name: /Team/i });

      // All closed initially
      expect(companyHeader.getAttribute("aria-expanded")).toBe("false");
      expect(ratesHeader.getAttribute("aria-expanded")).toBe("false");
      expect(teamHeader.getAttribute("aria-expanded")).toBe("false");

      // Open Company
      fireEvent.click(companyHeader);
      expect(companyHeader.getAttribute("aria-expanded")).toBe("true");
      expect(ratesHeader.getAttribute("aria-expanded")).toBe("false");
      expect(teamHeader.getAttribute("aria-expanded")).toBe("false");

      // Open Rates
      fireEvent.click(ratesHeader);
      expect(companyHeader.getAttribute("aria-expanded")).toBe("true");
      expect(ratesHeader.getAttribute("aria-expanded")).toBe("true");
      expect(teamHeader.getAttribute("aria-expanded")).toBe("false");

      // Open Team
      fireEvent.click(teamHeader);
      expect(companyHeader.getAttribute("aria-expanded")).toBe("true");
      expect(ratesHeader.getAttribute("aria-expanded")).toBe("true");
      expect(teamHeader.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("Edge cases", () => {
    beforeEach(() => {
      vi.resetModules();
      if (typeof window !== "undefined") {
        window.localStorage.clear();
      }
      mockNativePlatform(false);
      mockCapacitorPlugins();
    });

    it("empty Team section still renders header collapsed", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");

      render(
        <Disclosure id="setup-team" title="Team" defaultOpen={false}>
          <div data-testid="empty-team">
            <p>No team members yet</p>
            <button>+ Add team member</button>
          </div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Team/i });
      expect(header).toBeDefined();
      expect(header.getAttribute("aria-expanded")).toBe("false");

      // Empty state content exists but is collapsed
      const emptyState = screen.queryByTestId("empty-team");
      if (emptyState) {
        expect(emptyState.getAttribute("aria-hidden")).toBe("true");
      }
    });

    it("unsaved form state survives collapse", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");

      render(
        <Disclosure id="setup-company" title="Company" defaultOpen={true}>
          <input
            data-testid="company-name-input"
            defaultValue=""
            placeholder="Company name"
          />
        </Disclosure>
      );

      const input = screen.getByTestId("company-name-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Acme Ltd" } });
      expect(input.value).toBe("Acme Ltd");

      const header = screen.getByRole("button", { name: /Company/i });
      fireEvent.click(header); // Collapse
      fireEvent.click(header); // Expand

      // Input should still have its value (state preserved)
      expect(input.value).toBe("Acme Ltd");
    });

    it("works when localStorage is unavailable", async () => {
      // Make localStorage throw
      const originalLocalStorage = window.localStorage;
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("localStorage unavailable");
        },
        configurable: true,
      });

      const { Disclosure } = await import("@/components/ui/disclosure");

      expect(() => {
        render(
          <Disclosure id="setup-company" title="Company" defaultOpen={false}>
            <div>Content</div>
          </Disclosure>
        );

        const header = screen.getByRole("button", { name: /Company/i });
        fireEvent.click(header); // Should still toggle
      }).not.toThrow();

      // Restore
      Object.defineProperty(window, "localStorage", {
        value: originalLocalStorage,
        configurable: true,
      });
    });
  });

  describe("No content changes", () => {
    it("section content structure is preserved", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const setupFormPath = path.join(
        process.cwd(),
        "src/app/setup/setup-form.tsx"
      );
      const source = await fs.readFile(setupFormPath, "utf-8");

      // Key section markers should still exist (proving content wasn't removed)
      expect(source).toContain("Day rate");
      expect(source).toContain("Company name");
      expect(source).toContain("Team member");
      expect(source).toContain("trade discount");
      expect(source).toContain("Registered / business address");
      expect(source).toContain("Brand colour");
    });
  });
});
