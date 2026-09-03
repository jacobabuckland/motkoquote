import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Issue #519: HARN-1 — A fixture corpus for the quote pipeline
 *
 * These tests verify:
 * 1. Three or more fixture scenarios exist with all required parts
 * 2. Each scenario can be loaded and has the correct shape
 * 3. extractStatedPrices produces the expected extraction for each fixture
 * 4. Required coverage scenarios are present (supersession, fixed-price, customer-supplied)
 * 5. All PII has been redacted from fixtures
 */

describe("Issue #519: HARN-1 — Fixture corpus", () => {
  describe("Fixture structure", () => {
    it("exports scenario-1 with all four required parts", async () => {
      const scenario1 = await import("../../fixtures/pipeline/scenario-1");

      expect(scenario1.transcript).toBeDefined();
      expect(typeof scenario1.transcript).toBe("string");
      expect(scenario1.transcript.length).toBeGreaterThan(0);

      expect(scenario1.sowState).toBeDefined();
      expect(typeof scenario1.sowState).toBe("object");

      expect(scenario1.expectedStatedPrices).toBeDefined();
      expect(Array.isArray(scenario1.expectedStatedPrices)).toBe(true);

      expect(scenario1.expectedLineItems).toBeDefined();
      expect(Array.isArray(scenario1.expectedLineItems)).toBe(true);
    });

    it("exports scenario-2 with all four required parts", async () => {
      const scenario2 = await import("../../fixtures/pipeline/scenario-2");

      expect(scenario2.transcript).toBeDefined();
      expect(typeof scenario2.transcript).toBe("string");
      expect(scenario2.transcript.length).toBeGreaterThan(0);

      expect(scenario2.sowState).toBeDefined();
      expect(typeof scenario2.sowState).toBe("object");

      expect(scenario2.expectedStatedPrices).toBeDefined();
      expect(Array.isArray(scenario2.expectedStatedPrices)).toBe(true);

      expect(scenario2.expectedLineItems).toBeDefined();
      expect(Array.isArray(scenario2.expectedLineItems)).toBe(true);
    });

    it("exports scenario-3 with all four required parts", async () => {
      const scenario3 = await import("../../fixtures/pipeline/scenario-3");

      expect(scenario3.transcript).toBeDefined();
      expect(typeof scenario3.transcript).toBe("string");
      expect(scenario3.transcript.length).toBeGreaterThan(0);

      expect(scenario3.sowState).toBeDefined();
      expect(typeof scenario3.sowState).toBe("object");

      expect(scenario3.expectedStatedPrices).toBeDefined();
      expect(Array.isArray(scenario3.expectedStatedPrices)).toBe(true);

      expect(scenario3.expectedLineItems).toBeDefined();
      expect(Array.isArray(scenario3.expectedLineItems)).toBe(true);
    });

    it("provides a barrel export at fixtures/pipeline/index.ts", async () => {
      const index = await import("../../fixtures/pipeline/index");

      // At minimum, the three scenarios should be re-exported
      expect(index).toBeDefined();
    });
  });

  describe("SoW state shape", () => {
    it("scenario-1 sowState has required SowState fields", async () => {
      const { sowState } = await import("../../fixtures/pipeline/scenario-1");

      expect(sowState.job_type).toBeDefined();
      expect(Array.isArray(sowState.rooms)).toBe(true);
      expect(Array.isArray(sowState.stated_prices)).toBe(true);
    });

    it("scenario-2 sowState has required SowState fields", async () => {
      const { sowState } = await import("../../fixtures/pipeline/scenario-2");

      expect(sowState.job_type).toBeDefined();
      expect(Array.isArray(sowState.rooms)).toBe(true);
      expect(Array.isArray(sowState.stated_prices)).toBe(true);
    });

    it("scenario-3 sowState has required SowState fields", async () => {
      const { sowState } = await import("../../fixtures/pipeline/scenario-3");

      expect(sowState.job_type).toBeDefined();
      expect(Array.isArray(sowState.rooms)).toBe(true);
      expect(Array.isArray(sowState.stated_prices)).toBe(true);
    });
  });

  describe("Extraction fidelity", () => {
    it("scenario-1 transcript extracts to expectedStatedPrices exactly", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");
      const { transcript, expectedStatedPrices } = await import("../../fixtures/pipeline/scenario-1");

      const extracted = extractStatedPrices(transcript);

      expect(extracted).toEqual(expectedStatedPrices);
    });

    it("scenario-2 transcript extracts to expectedStatedPrices exactly", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");
      const { transcript, expectedStatedPrices } = await import("../../fixtures/pipeline/scenario-2");

      const extracted = extractStatedPrices(transcript);

      expect(extracted).toEqual(expectedStatedPrices);
    });

    it("scenario-3 transcript extracts to expectedStatedPrices exactly", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");
      const { transcript, expectedStatedPrices } = await import("../../fixtures/pipeline/scenario-3");

      const extracted = extractStatedPrices(transcript);

      expect(extracted).toEqual(expectedStatedPrices);
    });
  });

  describe("Line item shape", () => {
    it("scenario-1 expectedLineItems are valid LineItem objects", async () => {
      const { expectedLineItems } = await import("../../fixtures/pipeline/scenario-1");

      expect(expectedLineItems.length).toBeGreaterThan(0);
      for (const item of expectedLineItems) {
        expect(item.description).toBeDefined();
        expect(item.category).toBeDefined();
        expect(item.quantity).toBeDefined();
        expect(item.unit).toBeDefined();
        expect(item.unit_price).toBeDefined();
      }
    });

    it("scenario-2 expectedLineItems are valid LineItem objects", async () => {
      const { expectedLineItems } = await import("../../fixtures/pipeline/scenario-2");

      expect(expectedLineItems.length).toBeGreaterThan(0);
      for (const item of expectedLineItems) {
        expect(item.description).toBeDefined();
        expect(item.category).toBeDefined();
        expect(item.quantity).toBeDefined();
        expect(item.unit).toBeDefined();
        expect(item.unit_price).toBeDefined();
      }
    });

    it("scenario-3 expectedLineItems are valid LineItem objects", async () => {
      const { expectedLineItems } = await import("../../fixtures/pipeline/scenario-3");

      expect(expectedLineItems.length).toBeGreaterThan(0);
      for (const item of expectedLineItems) {
        expect(item.description).toBeDefined();
        expect(item.category).toBeDefined();
        expect(item.quantity).toBeDefined();
        expect(item.unit).toBeDefined();
        expect(item.unit_price).toBeDefined();
      }
    });
  });

  describe("Required coverage scenarios", () => {
    it("at least one fixture has a superseded stated price", async () => {
      const scenario1 = await import("../../fixtures/pipeline/scenario-1");
      const scenario2 = await import("../../fixtures/pipeline/scenario-2");
      const scenario3 = await import("../../fixtures/pipeline/scenario-3");

      const allPrices = [
        ...scenario1.expectedStatedPrices,
        ...scenario2.expectedStatedPrices,
        ...scenario3.expectedStatedPrices,
      ];

      const hasSupersession = allPrices.some((price) => price.superseded_by !== null);

      expect(hasSupersession, "At least one fixture must include a superseded price").toBe(true);
    });

    it("at least one fixture is a fixed-price quote", async () => {
      const scenario1 = await import("../../fixtures/pipeline/scenario-1");
      const scenario2 = await import("../../fixtures/pipeline/scenario-2");
      const scenario3 = await import("../../fixtures/pipeline/scenario-3");

      const allSows = [scenario1.sowState, scenario2.sowState, scenario3.sowState];

      const hasFixedPrice = allSows.some(
        (sow) => sow.pricing?.mode === "fixed" && sow.pricing.fixed_amount != null
      );

      expect(hasFixedPrice, "At least one fixture must be a fixed-price quote").toBe(true);
    });

    it("at least one fixture has a customer-supplied material", async () => {
      const scenario1 = await import("../../fixtures/pipeline/scenario-1");
      const scenario2 = await import("../../fixtures/pipeline/scenario-2");
      const scenario3 = await import("../../fixtures/pipeline/scenario-3");

      const allLineItems = [
        ...scenario1.expectedLineItems,
        ...scenario2.expectedLineItems,
        ...scenario3.expectedLineItems,
      ];

      const hasCustomerSupplied = allLineItems.some(
        (item) => item.supplied_by === "customer" && item.unit_price === 0
      );

      expect(
        hasCustomerSupplied,
        "At least one fixture must include a customer-supplied material (£0)"
      ).toBe(true);
    });
  });

  describe("PII redaction", () => {
    it("fenland-bathroom.md has been redacted of all PII", () => {
      const fixturePath = resolve(__dirname, "../../fixtures/fenland-bathroom.md");
      const content = readFileSync(fixturePath, "utf-8");

      // Original PII that must not appear
      expect(content).not.toContain("Margaret Doyle");
      expect(content).not.toContain("17 Chapel Loke");
      expect(content).not.toContain("Wymondham");
      expect(content).not.toContain("NR18 0QT");
      expect(content).not.toContain("07700 900112");
    });

    it("no scenario fixture contains unredacted phone numbers", async () => {
      const scenario1 = await import("../../fixtures/pipeline/scenario-1");
      const scenario2 = await import("../../fixtures/pipeline/scenario-2");
      const scenario3 = await import("../../fixtures/pipeline/scenario-3");

      const allTranscripts = [scenario1.transcript, scenario2.transcript, scenario3.transcript];

      // UK phone patterns: 07xxx xxxxxx or 01xxx xxxxxx
      const ukPhonePattern = /\b0[17]\d{3}\s?\d{6}\b/;

      for (const transcript of allTranscripts) {
        expect(ukPhonePattern.test(transcript), "Transcript must not contain UK phone numbers").toBe(
          false
        );
      }
    });

    it("no scenario fixture contains unredacted postcodes", async () => {
      const scenario1 = await import("../../fixtures/pipeline/scenario-1");
      const scenario2 = await import("../../fixtures/pipeline/scenario-2");
      const scenario3 = await import("../../fixtures/pipeline/scenario-3");

      const allTranscripts = [scenario1.transcript, scenario2.transcript, scenario3.transcript];

      // UK postcode pattern: letter(s) + digit(s) + space + digit + letter(s)
      // This is deliberately conservative to catch common patterns
      const ukPostcodePattern = /\b[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}\b/i;

      for (const transcript of allTranscripts) {
        expect(
          ukPostcodePattern.test(transcript),
          "Transcript must not contain UK postcodes"
        ).toBe(false);
      }
    });

    it("scenario sowStates have no customer PII in customer detail fields", async () => {
      const scenario1 = await import("../../fixtures/pipeline/scenario-1");
      const scenario2 = await import("../../fixtures/pipeline/scenario-2");
      const scenario3 = await import("../../fixtures/pipeline/scenario-3");

      const allSows = [scenario1.sowState, scenario2.sowState, scenario3.sowState];

      for (const sow of allSows) {
        // Customer detail fields should be either absent/null or clearly redacted placeholders
        if (sow.customer_name) {
          expect(
            sow.customer_name.includes("[REDACTED]") || sow.customer_name.includes("Customer"),
            "customer_name must be redacted"
          ).toBe(true);
        }

        if (sow.customer_phone) {
          expect(
            sow.customer_phone.includes("[REDACTED]") ||
              !/\b0[17]\d{3}\s?\d{6}\b/.test(sow.customer_phone),
            "customer_phone must be redacted"
          ).toBe(true);
        }

        if (sow.customer_email) {
          expect(
            sow.customer_email.includes("[REDACTED]") ||
              sow.customer_email.includes("@example.com"),
            "customer_email must be redacted"
          ).toBe(true);
        }

        if (sow.site_address) {
          const ukPostcodePattern = /\b[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}\b/i;
          expect(
            sow.site_address.includes("[REDACTED]") || !ukPostcodePattern.test(sow.site_address),
            "site_address must not contain real postcodes"
          ).toBe(true);
        }
      }
    });
  });
});
