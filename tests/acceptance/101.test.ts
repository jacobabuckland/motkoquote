import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
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
    it("states TrueLayer as the payment provider", () => {
      const readme = readFile("README.md");

      // Should mention TrueLayer
      expect(readme).toMatch(/TrueLayer/i);

      // Should mention VRP (Variable Recurring Payments) for fee collection
      expect(readme).toMatch(/VRP/i);

      // Should mention payment initiation
      expect(readme).toMatch(/payment.{0,20}initiation/i);
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

    it("does not describe Stripe as a current payment provider", () => {
      const readme = readFile("README.md");

      // If Stripe appears, it should only be in historical context or dead-column notes
      // NOT in active "Payments |" table row describing current provider
      const stackTableMatch = readme.match(/\|\s*Payments\s*\|([^|]+)\|/i);
      if (stackTableMatch) {
        const paymentsRow = stackTableMatch[1];
        expect(paymentsRow).not.toMatch(/Stripe/i);
        expect(paymentsRow).toMatch(/TrueLayer/i);
      }
    });
  });

  describe("docs/STATUS.md describes the stack accurately", () => {
    it("states TrueLayer as the payment provider", () => {
      const status = readFile("docs/STATUS.md");

      // Should mention TrueLayer
      expect(status).toMatch(/TrueLayer/i);

      // Should describe VRP for fee collection
      expect(status).toMatch(/VRP/i);

      // Should describe payment initiation for customer payments
      expect(status).toMatch(/payment.{0,30}initiation/i);
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

    it("notes the stripe_* columns as dead with zero code references", () => {
      const status = readFile("docs/STATUS.md");

      // Should mention stripe_* columns AND indicate they are dead/unused
      expect(status).toMatch(/stripe_/);
      expect(status).toMatch(/dead|unused|zero.*references|no.*code.*reference/i);
    });

    it("does not describe Stripe as a current payment provider", () => {
      const status = readFile("docs/STATUS.md");

      // Stripe may appear in the dead-column note, but NOT as the active provider
      // in the "Stack (as actually built)" table
      const stackSection = status.match(/## 2\. Stack \(as actually built\)([\s\S]*?)(?=##|$)/);
      if (stackSection) {
        const stackTable = stackSection[1];
        const paymentsRow = stackTable.match(/\|\s*Payments\s*\|([^|]+)\|/i);
        if (paymentsRow) {
          expect(paymentsRow[1]).not.toMatch(/Stripe/i);
          expect(paymentsRow[1]).toMatch(/TrueLayer/i);
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

  describe("Codebase state: stripe_* columns have zero code references", () => {
    it("has no TypeScript references to stripe_* columns", () => {
      // Walked with node:fs rather than glob, which is not a declared
      // dependency here — it only resolves transitively through
      // @capacitor/cli, so a bump there would silently break this test.
      const tsFiles = readdirSync(join(process.cwd(), "src"), {
        recursive: true,
        encoding: "utf-8",
      })
        .filter((entry) => /\.tsx?$/.test(entry))
        .map((entry) => join("src", entry));

      const stripeColumnPattern = /stripe_(payment_link_id|payment_link_url|invoice_id|account_id|charges_enabled|payouts_enabled|requirements_due)/;

      for (const file of tsFiles) {
        const content = readFile(file);
        if (stripeColumnPattern.test(content)) {
          throw new Error(
            `Found reference to stripe_* column in ${file}. ` +
            `These columns are marked as dead and should have zero code references.`
          );
        }
      }

      // If we get here, no references were found
      expect(true).toBe(true);
    });
  });
});
