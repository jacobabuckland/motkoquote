/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";

describe("FEE-3: Delete retired mandate UI, make fee surfaces permanent", () => {
  describe("Retired fee-runway files are deleted", () => {
    it("deletes the FeeRunwayBanner component", async () => {
      const path = "src/components/ui/fee-runway-banner.tsx";
      expect(
        existsSync(path),
        `${path} must be deleted — it described the retired VRP mandate model`,
      ).toBe(false);
    });

    it("deletes the fee-runway library", async () => {
      const path = "src/lib/fee-runway.ts";
      expect(
        existsSync(path),
        `${path} must be deleted — it computed runway state for the retired model`,
      ).toBe(false);
    });

    it("deletes the fee-runway test file", async () => {
      const path = "src/lib/fee-runway.test.ts";
      expect(
        existsSync(path),
        `${path} must be deleted — no code to test once fee-runway.ts is gone`,
      ).toBe(false);
    });
  });

  describe("Dashboard no longer renders FeeRunwayBanner", () => {
    it("does not import FeeRunwayBanner or loadFeeRunway", async () => {
      const mod = await import("@/app/dashboard/page");
      expect(mod).toBeDefined();

      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile("src/app/dashboard/page.tsx", "utf-8"),
      );

      expect(
        source,
        "dashboard/page.tsx must not import FeeRunwayBanner",
      ).not.toContain("FeeRunwayBanner");

      expect(
        source,
        "dashboard/page.tsx must not import loadFeeRunway from fee-runway",
      ).not.toContain("loadFeeRunway");

      expect(
        source,
        "dashboard/page.tsx must not import from @/lib/fee-runway",
      ).not.toContain("@/lib/fee-runway");

      expect(
        source,
        "dashboard/page.tsx must not import from @/components/ui/fee-runway-banner",
      ).not.toContain("@/components/ui/fee-runway-banner");
    });

    it("does not call loadFeeRunway anywhere in the file", async () => {
      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile("src/app/dashboard/page.tsx", "utf-8"),
      );

      expect(
        source,
        "dashboard must not call loadFeeRunway — the banner is deleted",
      ).not.toContain("loadFeeRunway(");
    });

    it("does not render <FeeRunwayBanner", async () => {
      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile("src/app/dashboard/page.tsx", "utf-8"),
      );

      expect(
        source,
        "dashboard must not render FeeRunwayBanner JSX — component is deleted",
      ).not.toContain("<FeeRunwayBanner");
    });

    it("does not reference the feeRunway variable", async () => {
      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile("src/app/dashboard/page.tsx", "utf-8"),
      );

      // The variable assignment or usage would appear as "feeRunway" in the source.
      // We allow "freeJobsRemaining" (the chip) but not "feeRunway".
      const lines = source.split("\n").filter((line) => line.includes("feeRunway"));

      expect(
        lines.length,
        `dashboard must not reference feeRunway variable — found ${lines.length} line(s): ${lines.join("; ")}`,
      ).toBe(0);
    });
  });

  describe("Free-jobs chip still renders unconditionally", () => {
    it("still shows the free jobs balance when freeJobsRemaining > 0", async () => {
      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile("src/app/dashboard/page.tsx", "utf-8"),
      );

      // The chip is at lines ~233-240, guarded by {freeJobsRemaining > 0 &&
      expect(
        source,
        "free-jobs chip must still render when balance > 0",
      ).toContain("freeJobsRemaining > 0");

      expect(
        source,
        "chip must show the balance: {freeJobsRemaining} free job{s} left",
      ).toContain("{freeJobsRemaining} free job");

      expect(
        source,
        "chip must link to /settings where the fees statement lives",
      ).toContain('href="/settings"');
    });
  });

  describe("Referral section copy reflects FEE-1 grants", () => {
    it("updates the reward copy to reflect 3 free jobs rising to 5", async () => {
      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile("src/app/settings/referral-section.tsx", "utf-8"),
      );

      // The old copy was "you get 5 more fee-free jobs" — that's wrong now.
      expect(
        source,
        "referral section must not promise 5 free jobs unconditionally",
      ).not.toContain("you get 5 more fee-free jobs");

      expect(
        source,
        "referral section must not promise 5 fee-free jobs unconditionally",
      ).not.toContain("5 more fee-free jobs");

      // The new copy must explain:
      // 1. What the referred trade gets (3 free jobs)
      // 2. What the referrer gets (3 rising to 5 at the champion tier of 5 activated)

      // Must mention "3 free jobs" or "3 fee-free jobs" for the referred trade
      expect(
        source,
        "referral section must mention 3 free jobs",
      ).toMatch(/3 (?:free|fee-free) jobs/i);

      // The spec says: "they get 3 free jobs, and you get 3 more (rising to 5 at 5 activated referrals)"
      // So we need copy that mentions both the referee's reward and the referrer's tiered reward.
      // Accept either "3 more" or "3 free jobs" for the referrer's base reward.
      expect(
        source,
        "referral section must explain the tiered reward: 3 rising to 5",
      ).toMatch(/\b3\b.*\b5\b|rising.*5|unlock.*5|5.*activated/i);
    });

    it("still imports and exports ReferralSection component", async () => {
      const mod = await import("@/app/settings/referral-section");

      expect(
        mod.ReferralSection,
        "ReferralSection component must still exist and be exported",
      ).toBeDefined();

      expect(
        typeof mod.ReferralSection,
        "ReferralSection must be a function component",
      ).toBe("function");
    });
  });

  describe("Fees statement remains ungated", () => {
    it("renders FeesStatementSection unconditionally in settings", async () => {
      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile("src/app/settings/page.tsx", "utf-8"),
      );

      // The fees statement is rendered at line 76, guarded only by contractor?.id
      expect(
        source,
        "settings must render FeesStatementSection",
      ).toContain("FeesStatementSection");

      expect(
        source,
        "FeesStatementSection must only be guarded by contractor?.id, not a billing flag",
      ).toContain("contractor?.id && <FeesStatementSection");

      // Must NOT be gated by any fee billing flag
      expect(
        source,
        "settings must not check FEE_BILLING_ENABLED or any billing flag",
      ).not.toMatch(/FEE_BILLING_ENABLED|feeBillingEnabled|billingEnabled/);
    });
  });

  describe("Mark-as-paid fee line remains ungated", () => {
    it("always computes and shows the fee line, not gated by a flag", async () => {
      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile("src/app/jobs/[id]/mark-as-paid-button.tsx", "utf-8"),
      );

      // The fee line is computed via markPaidFeeLine at line ~54
      expect(
        source,
        "mark-as-paid button must call markPaidFeeLine to show the fee",
      ).toContain("markPaidFeeLine");

      expect(
        source,
        "mark-as-paid button must render the fee line in the dialog",
      ).toContain("{feeLine}");

      // Must not be gated by any billing flag
      expect(
        source,
        "mark-as-paid must not check FEE_BILLING_ENABLED or any billing flag",
      ).not.toMatch(/FEE_BILLING_ENABLED|feeBillingEnabled|billingEnabled/);
    });
  });

  describe("No reference to deleted fee-runway code remains", () => {
    it("does not import fee-runway anywhere in src/", async () => {
      const { execSync } = await import("node:child_process");

      // Grep for any import from fee-runway in src/ (excluding node_modules, tests, docs)
      const result = execSync(
        'grep -r "from.*fee-runway" src/ || true',
        { encoding: "utf-8" },
      );

      expect(
        result.trim(),
        "No file in src/ may import from fee-runway — the file is deleted",
      ).toBe("");
    });

    it("does not reference FeeRunwayBanner anywhere in src/", async () => {
      const { execSync } = await import("node:child_process");

      const result = execSync(
        'grep -r "FeeRunwayBanner" src/ || true',
        { encoding: "utf-8" },
      );

      expect(
        result.trim(),
        "No file in src/ may reference FeeRunwayBanner — the component is deleted",
      ).toBe("");
    });

    it("does not reference loadFeeRunway, computeFeeRunway, or feeRunwayBannerCopy in src/", async () => {
      const { execSync } = await import("node:child_process");

      const result = execSync(
        'grep -rE "loadFeeRunway|computeFeeRunway|feeRunwayBannerCopy" src/ || true',
        { encoding: "utf-8" },
      );

      expect(
        result.trim(),
        "No file in src/ may reference deleted fee-runway exports",
      ).toBe("");
    });
  });

  describe("No FEE_BILLING_ENABLED reference remains", () => {
    it("does not reference FEE_BILLING_ENABLED in src/ code", async () => {
      const { execSync } = await import("node:child_process");

      // Grep for FEE_BILLING_ENABLED but exclude comment-only references
      // (fee-copy.ts has historical comments explaining the flag was removed)
      const result = execSync(
        'grep -r "FEE_BILLING_ENABLED" src/ --include="*.ts" --include="*.tsx" | grep -v "^[^:]*:.*//.*FEE_BILLING_ENABLED" || true',
        { encoding: "utf-8" },
      );

      expect(
        result.trim(),
        "No file in src/ may reference FEE_BILLING_ENABLED in code (comments are ok)",
      ).toBe("");
    });

    it("does not reference FEE_BILLING_ENABLED in .env.example", async () => {
      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile(".env.example", "utf-8"),
      );

      expect(
        source,
        ".env.example must not reference FEE_BILLING_ENABLED — the flag is retired",
      ).not.toContain("FEE_BILLING_ENABLED");
    });
  });

  describe("No PLATFORM_APPLICATION_FEE_PENCE remains", () => {
    it("does not reference PLATFORM_APPLICATION_FEE_PENCE in .env.example or src/", async () => {
      const { execSync } = await import("node:child_process");

      // Check .env.example and src/ only, excluding tests (tests describe what should be removed)
      const result = execSync(
        'grep -r "PLATFORM_APPLICATION_FEE_PENCE" .env.example src/ 2>/dev/null || true',
        { encoding: "utf-8" },
      );

      expect(
        result.trim(),
        "PLATFORM_APPLICATION_FEE_PENCE must not appear in .env.example or src/ — it was a misleading leftover",
      ).toBe("");
    });
  });

  describe("Sending a quote is never blocked by fee state", () => {
    it("does not check mandateAuthorized anywhere in the send-quote path", async () => {
      const { execSync } = await import("node:child_process");

      const result = execSync(
        'grep -r "mandateAuthorized" src/app/jobs/ || true',
        { encoding: "utf-8" },
      );

      expect(
        result.trim(),
        "jobs actions must not check mandateAuthorized — no VRP mandate exists",
      ).toBe("");
    });

    it("does not block quote-sending based on free jobs or fee state", async () => {
      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile("src/app/jobs/actions.ts", "utf-8"),
      );

      // sendQuote must not consult fee runway state to block the action
      expect(
        source,
        "sendQuote must not check fee runway or mandate state to block sending",
      ).not.toMatch(/computeFeeRunway|loadFeeRunway|mandateAuthorized|canSendQuote/);

      // It's fine for it to read freeJobsRemaining to pass to settlement or
      // logging, but it must not GATE the send on it.
      // We assert the absence of blocking keywords rather than presence of
      // freeJobsRemaining, since reading the balance is allowed.
    });
  });

  describe("Contractor with 0 free jobs can still send quotes and take payment", () => {
    it("sendQuote does not gate on freeJobsRemaining or fee state", async () => {
      // This is already verified by the "does not block quote-sending based on
      // free jobs or fee state" test above. We add this test to make the
      // acceptance criterion explicit: a contractor with 0 free jobs can send.

      const source = await import("node:fs").then((fs) =>
        fs.promises.readFile("src/app/jobs/actions.ts", "utf-8"),
      );

      // sendQuote must not check freeJobsRemaining or fee runway to block.
      // It's fine to READ freeJobsRemaining for settlement, but not to GATE on it.
      expect(
        source,
        "sendQuote must not throw based on freeJobsRemaining being 0",
      ).not.toMatch(/if.*freeJobsRemaining.*===.*0.*throw|if.*freeJobsRemaining.*<.*1.*throw/);

      // The broader check (no computeFeeRunway etc) is already asserted above.
    });
  });
});
