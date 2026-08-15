import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const readFile = (path: string): string => {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(fullPath, "utf-8");
};

describe("Issue #101: Update STATUS.md and README: TrueLayer not Stripe, multi-provider LLM, SMS wired", () => {
  describe("README.md describes the stack accurately", () => {
    it("states Stripe as the payment provider", () => {
      const readme = readFile("README.md");

      // Should mention Stripe
      expect(readme).toMatch(/Stripe/i);

      // Should mention Pay by Bank, the rail that replaced VRP
      expect(readme).toMatch(/Pay by Bank/i);

      // Should describe fees collected at source as application fees
      expect(readme).toMatch(/application fee|at source/i);
    });

    it("describes the LLM setup as multi-provider", () => {
      const readme = readFile("README.md");

      // Should mention both Anthropic/Claude and OpenAI
      expect(readme).toMatch(/Anthropic|Claude/i);
      expect(readme).toMatch(/OpenAI/i);
    });

    it("states SMS is wired via Twilio", () => {
      const readme = readFile("README.md");

      // Should mention Twilio
      expect(readme).toMatch(/Twilio/i);
    });

    it("does not describe TrueLayer as a current payment provider", () => {
      const readme = readFile("README.md");

      // If Stripe appears, it should only be in historical context or dead-column notes
      // NOT in active "Payments |" table row describing current provider
      const stackTableMatch = readme.match(/\|\s*Payments\s*\|([^|]+)\|/i);
      if (stackTableMatch) {
        const paymentsRow = stackTableMatch[1];
        expect(paymentsRow).not.toMatch(/TrueLayer/i);
        expect(paymentsRow).toMatch(/Stripe/i);
      }
    });
  });

  describe("docs/STATUS.md describes the stack accurately", () => {
    it("states Stripe as the payment provider", () => {
      const status = readFile("docs/STATUS.md");

      // Should mention Stripe
      expect(status).toMatch(/Stripe/i);

      // Should describe Pay by Bank, the rail that replaced VRP
      expect(status).toMatch(/Pay by Bank/i);

      // Should describe fees collected at source as application fees
      expect(status).toMatch(/application fee|at source/i);
    });

    it("describes the LLM setup as multi-provider", () => {
      const status = readFile("docs/STATUS.md");

      // Should mention both Anthropic/Claude AND OpenAI with their respective uses
      expect(status).toMatch(/Anthropic|Claude/i);
      expect(status).toMatch(/OpenAI/i);
    });

    it("states that SMS is wired via Twilio", () => {
      const status = readFile("docs/STATUS.md");

      // Should mention Twilio positively (not "is not wired")
      expect(status).toMatch(/Twilio/i);

      // Should NOT contain the false claim that SMS is not wired
      expect(status).not.toMatch(/SMS is not wired/i);
      expect(status).not.toMatch(/SMS.{0,50}not wired/i);
    });

    // Retired by PAY-5 (#211). The stripe_* columns stopped being dead when
    // PAY-2 re-activated them for Connect onboarding, so requiring STATUS.md to
    // describe them as unused now asserts the opposite of the truth.

    it("does not describe TrueLayer as a current payment provider", () => {
      const status = readFile("docs/STATUS.md");

      // Stripe may appear in the dead-column note, but NOT as the active provider
      // in the "Stack (as actually built)" table
      const stackSection = status.match(/## 2\. Stack \(as actually built\)([\s\S]*?)(?=##|$)/);
      if (stackSection) {
        const stackTable = stackSection[1];
        const paymentsRow = stackTable.match(/\|\s*Payments\s*\|([^|]+)\|/i);
        if (paymentsRow) {
          expect(paymentsRow[1]).not.toMatch(/TrueLayer/i);
          expect(paymentsRow[1]).toMatch(/Stripe/i);
        }
      }
    });
  });

  describe("Pull request template enforces documentation updates", () => {
    it("exists at .github/pull_request_template.md", () => {
      expect(existsSync(join(process.cwd(), ".github/pull_request_template.md"))).toBe(true);
    });

    it("contains a checklist item for documentation updates when providers or integrations change", () => {
      const template = readFile(".github/pull_request_template.md");

      // Should have a checkbox/checklist item
      expect(template).toMatch(/- \[ \]/);

      // Should mention documentation updates
      expect(template).toMatch(/documentation|docs/i);

      // Should mention providers or integrations
      expect(template).toMatch(/provider|integration/i);
    });
  });

  // Retired by PAY-2 (#216). This asserted the stripe_* columns were dead with
  // zero code references, which was true while payments ran on TrueLayer. The
  // Stripe Connect migration re-activates exactly those columns, so the
  // criterion is now false by design rather than by regression — it is removed
  // here rather than left to fail on every ticket in the PAY series.
});
