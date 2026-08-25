/**
 * @vitest-environment happy-dom
 *
 * Acceptance tests for Issue #359: Collapse the remaining Settings sections
 */

import { describe, it, expect } from "vitest";

describe("Issue #359: Collapse the remaining Settings sections", () => {
  describe("Settings page uses Disclosure for four sections", () => {
    it("imports Disclosure component", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      expect(
        source,
        "page.tsx must import Disclosure from ui/disclosure",
      ).toContain('from "@/components/ui/disclosure"');
    });

    it("wraps fees statement in Disclosure with id fees", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      // Must have a Disclosure with id="fees"
      expect(
        source,
        "must have Disclosure with id fees",
      ).toMatch(/<Disclosure[^>]*id="fees"/);

      // The Disclosure must have a title
      expect(
        source,
        "fees Disclosure must have title prop",
      ).toMatch(/<Disclosure[^>]*id="fees"[^>]*title=/);

      // FeesStatementSection must still be rendered
      expect(
        source,
        "must still render FeesStatementSection",
      ).toContain("FeesStatementSection");
    });

    it("wraps referral section in Disclosure with id referral", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      expect(
        source,
        "must have Disclosure with id referral",
      ).toMatch(/<Disclosure[^>]*id="referral"/);

      expect(
        source,
        "referral Disclosure must have title prop",
      ).toMatch(/<Disclosure[^>]*id="referral"[^>]*title=/);

      expect(
        source,
        "must still render ReferralSection",
      ).toContain("ReferralSection");
    });

    it("wraps notifications in Disclosure with id notifications", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      // Check if wrapping is in page.tsx or in settings-client.tsx
      const pagePath = path.join(process.cwd(), "src/app/settings/page.tsx");
      const clientPath = path.join(process.cwd(), "src/app/settings/settings-client.tsx");

      const pageSource = await fs.readFile(pagePath, "utf-8");
      const clientSource = await fs.readFile(clientPath, "utf-8");

      // Must have Disclosure with id notifications in either file
      const hasNotificationsDisclosure =
        /<Disclosure[^>]*id="notifications"/.test(pageSource) ||
        /<Disclosure[^>]*id="notifications"/.test(clientSource);

      expect(
        hasNotificationsDisclosure,
        "must have Disclosure with id notifications in page.tsx or settings-client.tsx",
      ).toBe(true);

      // Must still render SettingsClient
      expect(
        pageSource,
        "page.tsx must still render SettingsClient",
      ).toContain("SettingsClient");
    });

    it("wraps support section in Disclosure with id support", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      expect(
        source,
        "must have Disclosure with id support",
      ).toMatch(/<Disclosure[^>]*id="support"/);

      expect(
        source,
        "support Disclosure must have title prop",
      ).toMatch(/<Disclosure[^>]*id="support"[^>]*title=/);

      expect(
        source,
        "must still render SupportSection",
      ).toContain("SupportSection");
    });
  });

  describe("All new Disclosure sections use defaultOpen={true}", () => {
    it("fees disclosure has defaultOpen={true}", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      // Extract the fees Disclosure element
      const feesDisclosureMatch = source.match(
        /<Disclosure[^>]*id="fees"[^>]*>/
      );
      expect(feesDisclosureMatch, "fees Disclosure must exist").toBeTruthy();

      if (feesDisclosureMatch) {
        const disclosureTag = feesDisclosureMatch[0];
        expect(
          disclosureTag,
          "fees Disclosure must have defaultOpen={true}",
        ).toContain("defaultOpen={true}");
      }
    });

    it("referral disclosure has defaultOpen={true}", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      const referralDisclosureMatch = source.match(
        /<Disclosure[^>]*id="referral"[^>]*>/
      );
      expect(referralDisclosureMatch, "referral Disclosure must exist").toBeTruthy();

      if (referralDisclosureMatch) {
        const disclosureTag = referralDisclosureMatch[0];
        expect(
          disclosureTag,
          "referral Disclosure must have defaultOpen={true}",
        ).toContain("defaultOpen={true}");
      }
    });

    it("notifications disclosure has defaultOpen={true}", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const pagePath = path.join(process.cwd(), "src/app/settings/page.tsx");
      const clientPath = path.join(process.cwd(), "src/app/settings/settings-client.tsx");

      const pageSource = await fs.readFile(pagePath, "utf-8");
      const clientSource = await fs.readFile(clientPath, "utf-8");

      const combinedSource = pageSource + "\n" + clientSource;

      const notificationsDisclosureMatch = combinedSource.match(
        /<Disclosure[^>]*id="notifications"[^>]*>/
      );
      expect(notificationsDisclosureMatch, "notifications Disclosure must exist").toBeTruthy();

      if (notificationsDisclosureMatch) {
        const disclosureTag = notificationsDisclosureMatch[0];
        expect(
          disclosureTag,
          "notifications Disclosure must have defaultOpen={true}",
        ).toContain("defaultOpen={true}");
      }
    });

    it("support disclosure has defaultOpen={true}", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      const supportDisclosureMatch = source.match(
        /<Disclosure[^>]*id="support"[^>]*>/
      );
      expect(supportDisclosureMatch, "support Disclosure must exist").toBeTruthy();

      if (supportDisclosureMatch) {
        const disclosureTag = supportDisclosureMatch[0];
        expect(
          disclosureTag,
          "support Disclosure must have defaultOpen={true}",
        ).toContain("defaultOpen={true}");
      }
    });
  });

  describe("Existing Getting paid Disclosure unchanged", () => {
    it("payout-details disclosure still has defaultOpen={false}", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      const payoutDisclosureMatch = source.match(
        /<Disclosure[^>]*id="payout-details"[^>]*>/
      );
      expect(payoutDisclosureMatch, "payout-details Disclosure must still exist").toBeTruthy();

      if (payoutDisclosureMatch) {
        const disclosureTag = payoutDisclosureMatch[0];
        expect(
          disclosureTag,
          "payout-details Disclosure must still have defaultOpen={false}",
        ).toContain("defaultOpen={false}");
      }
    });

    it("exactly one Disclosure has defaultOpen={false}", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      // Count all defaultOpen={false} occurrences
      const falseDefaults = source.match(/defaultOpen={false}/g) || [];

      expect(
        falseDefaults.length,
        "exactly one Disclosure should have defaultOpen={false} (the payout-details section)",
      ).toBe(1);
    });
  });

  describe("Delete account section remains unwrapped", () => {
    it("DeleteAccount is not wrapped in a Disclosure", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      // Find the DeleteAccount component
      const deleteAccountIndex = source.indexOf("<DeleteAccount");
      expect(deleteAccountIndex, "DeleteAccount must be rendered").toBeGreaterThan(-1);

      // Look backwards from DeleteAccount to find the nearest Disclosure opening tag
      const beforeDeleteAccount = source.slice(0, deleteAccountIndex);
      const lastDisclosureOpenBefore = beforeDeleteAccount.lastIndexOf("<Disclosure");
      const lastDisclosureCloseBefore = beforeDeleteAccount.lastIndexOf("</Disclosure>");

      // If there's a Disclosure opening before DeleteAccount, there must be a closing tag between them
      if (lastDisclosureOpenBefore > -1) {
        expect(
          lastDisclosureCloseBefore,
          "DeleteAccount must not be inside a Disclosure — there should be a closing </Disclosure> between the last <Disclosure and <DeleteAccount",
        ).toBeGreaterThan(lastDisclosureOpenBefore);
      }
    });
  });

  describe("Contractor guard on fees statement is preserved", () => {
    it("fees statement is still guarded by contractor existence", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      // The fees statement (whether wrapped in Disclosure or not) must be guarded by contractor?.id
      // We check that both "contractor?.id" and "fees" id appear in proximity
      expect(
        source,
        "contractor?.id guard must still be present",
      ).toContain("contractor?.id");

      expect(
        source,
        "fees section (by id) must be present",
      ).toMatch(/id="fees"/);

      // Check that they appear in a reasonable proximity (within a few lines)
      const contractorIndex = source.indexOf("contractor?.id");
      const feesIdIndex = source.indexOf('id="fees"');

      // Both must exist
      expect(contractorIndex, "contractor?.id must exist").toBeGreaterThan(-1);
      expect(feesIdIndex, "fees id must exist").toBeGreaterThan(-1);

      // They should be relatively close (within 500 characters is generous)
      const distance = Math.abs(contractorIndex - feesIdIndex);
      expect(
        distance,
        "contractor?.id and fees id should be close together in the source",
      ).toBeLessThan(500);
    });

    it("fees statement is not gated by any billing flag", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      // Must NOT check billing flags
      expect(
        source,
        "settings must not check FEE_BILLING_ENABLED or any billing flag",
      ).not.toMatch(/FEE_BILLING_ENABLED|feeBillingEnabled|billingEnabled/);
    });
  });

  describe("Section order preserved", () => {
    it("sections appear in correct order: payout, fees, referral, notifications, support, delete", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      // Find the positions of each section identifier
      const payoutIndex = source.indexOf('id="payout-details"');
      const feesIndex = source.indexOf('id="fees"');
      const referralIndex = source.indexOf('id="referral"');
      const notificationsIndex = source.indexOf('SettingsClient'); // Could be wrapped or not
      const supportIndex = source.indexOf('id="support"');
      const deleteIndex = source.indexOf('<DeleteAccount');

      // All must exist
      expect(payoutIndex, "payout section must exist").toBeGreaterThan(-1);
      expect(feesIndex, "fees section must exist").toBeGreaterThan(-1);
      expect(referralIndex, "referral section must exist").toBeGreaterThan(-1);
      expect(notificationsIndex, "notifications section must exist").toBeGreaterThan(-1);
      expect(supportIndex, "support section must exist").toBeGreaterThan(-1);
      expect(deleteIndex, "delete account section must exist").toBeGreaterThan(-1);

      // Check order
      expect(
        payoutIndex < feesIndex,
        "payout-details should come before fees",
      ).toBe(true);
      expect(
        feesIndex < referralIndex,
        "fees should come before referral",
      ).toBe(true);
      expect(
        referralIndex < notificationsIndex,
        "referral should come before notifications",
      ).toBe(true);
      expect(
        notificationsIndex < supportIndex,
        "notifications should come before support",
      ).toBe(true);
      expect(
        supportIndex < deleteIndex,
        "support should come before delete account",
      ).toBe(true);
    });
  });

  describe("Notifications wraps both headings", () => {
    it("notifications Disclosure wraps both h2 and h3 (if wrapped at call site)", async () => {
      const fs = await import("node:fs/promises");
      const pageSource = await fs.readFile("src/app/settings/page.tsx", "utf-8");

      // If notifications is wrapped in page.tsx, SettingsClient should be inside a Disclosure
      const hasNotificationsDisclosureInPage = pageSource.includes('id="notifications"');

      if (hasNotificationsDisclosureInPage) {
        // Find the notifications Disclosure block
        const notificationsStart = pageSource.indexOf('<Disclosure');
        const notificationsDisclosureMatch = pageSource.slice(notificationsStart).match(
          /<Disclosure[^>]*id="notifications"[^>]*>([\s\S]*?)<\/Disclosure>/
        );

        expect(
          notificationsDisclosureMatch,
          "notifications Disclosure must have opening and closing tags",
        ).toBeTruthy();

        if (notificationsDisclosureMatch) {
          const disclosureContent = notificationsDisclosureMatch[1];
          expect(
            disclosureContent,
            "notifications Disclosure must contain SettingsClient",
          ).toContain("SettingsClient");
        }
      }
    });

    it("if wrapped in settings-client, both h2 and h3 are inside one Disclosure", async () => {
      const fs = await import("node:fs/promises");
      const clientSource = await fs.readFile("src/app/settings/settings-client.tsx", "utf-8");

      // If the file imports Disclosure, it must be wrapping itself
      const importsDisclosure = clientSource.includes("Disclosure");

      if (importsDisclosure) {
        // Both heading texts must appear in the source
        expect(
          clientSource,
          "settings-client must contain Notifications h2",
        ).toContain("Notifications");

        expect(
          clientSource,
          "settings-client must contain What to notify me about h3",
        ).toContain("What to notify me about");

        // The Disclosure should wrap the return of the component
        expect(
          clientSource,
          "settings-client must have Disclosure with id notifications",
        ).toMatch(/<Disclosure[^>]*id="notifications"/);
      }
    });
  });

  describe("Disclosure primitive features work for new sections", () => {
    it("all new disclosure ids use kebab-case", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const pagePath = path.join(process.cwd(), "src/app/settings/page.tsx");
      const clientPath = path.join(process.cwd(), "src/app/settings/settings-client.tsx");

      const pageSource = await fs.readFile(pagePath, "utf-8");
      const clientSource = await fs.readFile(clientPath, "utf-8");
      const combinedSource = pageSource + "\n" + clientSource;

      // Find all Disclosure id values (excluding payout-details which already exists)
      const idMatches = combinedSource.match(/id="([^"]+)"/g) || [];
      const disclosureIds = idMatches
        .filter((match) => {
          const id = match.replace(/id="|"/g, "");
          // Filter to only the new ones (exclude payout-details and generic dom ids)
          return ["fees", "referral", "notifications", "support"].includes(id);
        })
        .map((match) => match.replace(/id="|"/g, ""));

      // All should be kebab-case (lowercase, hyphens only, no underscores or camelCase)
      disclosureIds.forEach((id) => {
        expect(
          /^[a-z]+(-[a-z]+)*$/.test(id),
          `Disclosure id "${id}" must be kebab-case`,
        ).toBe(true);
      });
    });
  });
});
