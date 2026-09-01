import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("Issue #335: FEE-4 marketing site copy", () => {
  const siteDir = join(process.cwd(), "site");

  describe("Homepage", () => {
    it("exists at site/index.html", () => {
      const homepagePath = join(siteDir, "index.html");
      expect(existsSync(homepagePath), "site/index.html must exist").toBe(true);
    });

    it('states "Your first three jobs are free" using the exact number "three"', () => {
      const homepage = readFileSync(join(siteDir, "index.html"), "utf8");

      // Must contain the exact phrase with "three"
      expect(
        homepage,
        'Homepage must contain "three" in the free jobs promise'
      ).toMatch(/three.*free|free.*three/i);

      // More specifically, should contain something like "first three jobs are free"
      expect(
        homepage,
        'Homepage must state "first three jobs"'
      ).toMatch(/first\s+three\s+jobs/i);
    });

    it('does not contain "free while in early access" or equivalent open-ended claims', () => {
      const homepage = readFileSync(join(siteDir, "index.html"), "utf8");

      // Reject "free while in early access"
      expect(
        homepage,
        'Must not contain "free while in early access"'
      ).not.toMatch(/free\s+while\s+in\s+early\s+access/i);

      // Reject "free during early access"
      expect(
        homepage,
        'Must not contain "free during early access"'
      ).not.toMatch(/free\s+during\s+early\s+access/i);

      // Reject "free during beta"
      expect(
        homepage,
        'Must not contain "free during beta"'
      ).not.toMatch(/free\s+during\s+beta/i);

      // Reject "free while in beta"
      expect(
        homepage,
        'Must not contain "free while in beta"'
      ).not.toMatch(/free\s+while\s+in\s+beta/i);
    });

    it('does not use "beta" to imply a free period or price', () => {
      const homepage = readFileSync(join(siteDir, "index.html"), "utf8");

      // Allow "beta" in general, but not in pricing context
      // Check for common patterns that use beta to imply free access
      expect(
        homepage,
        'Must not use "free beta" or "beta free"'
      ).not.toMatch(/free\s+beta|beta.*free/i);

      expect(
        homepage,
        'Must not say "free while" followed by beta'
      ).not.toMatch(/free\s+while.*beta/i);
    });
  });

  describe("/pricing page", () => {
    it("exists at site/pricing.html or site/pricing/index.html", () => {
      const pricingPath1 = join(siteDir, "pricing.html");
      const pricingPath2 = join(siteDir, "pricing", "index.html");

      const exists = existsSync(pricingPath1) || existsSync(pricingPath2);
      expect(exists, "/pricing page must exist").toBe(true);
    });

    // RETIRED by FEE-9 (#468), 31 Aug 2026. Three assertions removed, and only
    // these three — every other test in this file still runs.
    //
    //   "states all three fee bands with correct amounts"  (£2 / £6 / £10)
    //   "states the correct thresholds (£1,000 and £3,000)"
    //   "states fees are VAT-inclusive"
    //
    // FEE-4 published a flat three-band model described as VAT-inclusive. FEE-6
    // (#478) replaced the bands with an uncapped marginal ladder, and FEE-9's
    // card supersedes the published claims explicitly: its acceptance criteria
    // require that "the band figures £2 / £6 / £10" and "VAT-inclusive" appear
    // nowhere in the repo or on motko.co.uk. motko is not registered for VAT,
    // so there is no VAT in the fees to be inclusive of — the claim was
    // inaccurate as published, not merely superseded.
    //
    // The thresholds go with the bands: £1,000 and £3,000 are the boundaries of
    // a structure that no longer exists. The ladder breaks at £5,000 and
    // £10,000, and those are asserted in tests/regression/pricing-copy.test.ts
    // against `motkoFeePennies` rather than against a number typed twice.
    //
    // Deliberately NOT retired, because FEE-9 does not supersede them and both
    // still pass: "states fee is taken when customer pays", "states the
    // free-job waiver rule". The £2 waiver cap is still what
    // `planPaidJobSettlement` applies — FEE-11 is the ticket that removes it,
    // and it retires that assertion, not this one.

    it("states fee is taken when customer pays", () => {
      const pricingPath1 = join(siteDir, "pricing.html");
      const pricingPath2 = join(siteDir, "pricing", "index.html");
      const pricingPath = existsSync(pricingPath1) ? pricingPath1 : pricingPath2;

      const pricing = readFileSync(pricingPath, "utf8");

      // Look for mention of taking fee when customer pays
      expect(
        pricing,
        "Must explain when fee is taken"
      ).toMatch(/taken.*when.*customer.*pay|deducted.*customer.*pay|customer.*pay.*taken/i);
    });

    it("states nothing charged until contractor is paid", () => {
      const pricingPath1 = join(siteDir, "pricing.html");
      const pricingPath2 = join(siteDir, "pricing", "index.html");
      const pricingPath = existsSync(pricingPath1) ? pricingPath1 : pricingPath2;

      const pricing = readFileSync(pricingPath, "utf8");

      // Look for statement about not charging until contractor paid
      expect(
        pricing,
        "Must state nothing charged until contractor paid"
      ).toMatch(/nothing.*charged.*until.*paid|no.*charge.*until.*paid/i);
    });

    it("states referral reward: 3 free jobs per referral", () => {
      const pricingPath1 = join(siteDir, "pricing.html");
      const pricingPath2 = join(siteDir, "pricing", "index.html");
      const pricingPath = existsSync(pricingPath1) ? pricingPath1 : pricingPath2;

      const pricing = readFileSync(pricingPath, "utf8");

      // Look for "3 free jobs" in context of referral
      expect(
        pricing,
        "Must state 3 free jobs per referral"
      ).toMatch(/3.*free.*job.*referral|referral.*3.*free.*job/i);
    });

    it("states referral tier: 5 free jobs after 5 referrals", () => {
      const pricingPath1 = join(siteDir, "pricing.html");
      const pricingPath2 = join(siteDir, "pricing", "index.html");
      const pricingPath = existsSync(pricingPath1) ? pricingPath1 : pricingPath2;

      const pricing = readFileSync(pricingPath, "utf8");

      // Look for tier after 5 referrals giving 5 free jobs
      expect(
        pricing,
        "Must state tier of 5 free jobs after 5 referrals"
      ).toMatch(/5.*referral.*5.*free|after.*5.*referral.*5.*job/i);
    });

    it("states that credits stack", () => {
      const pricingPath1 = join(siteDir, "pricing.html");
      const pricingPath2 = join(siteDir, "pricing", "index.html");
      const pricingPath = existsSync(pricingPath1) ? pricingPath1 : pricingPath2;

      const pricing = readFileSync(pricingPath, "utf8");

      // Look for "stack" or "accumulate" in context of credits
      expect(
        pricing,
        "Must state credits stack or accumulate"
      ).toMatch(/credit.*stack|credit.*accumulate|stack|accumulate/i);
    });

    it("states the free-job waiver rule", () => {
      const pricingPath1 = join(siteDir, "pricing.html");
      const pricingPath2 = join(siteDir, "pricing", "index.html");
      const pricingPath = existsSync(pricingPath1) ? pricingPath1 : pricingPath2;

      const pricing = readFileSync(pricingPath, "utf8");

      // Free job covers £2, difference above £2 is payable on larger jobs
      // This is subtle — look for mention of free job covering standard fee
      // and difference being payable
      expect(
        pricing,
        "Must explain free job waiver rule"
      ).toMatch(/free.*job.*cover.*£2|free.*job.*standard.*fee/i);

      expect(
        pricing,
        "Must explain difference above £2 is payable"
      ).toMatch(/difference.*above.*£2.*pay|pay.*difference/i);
    });

    it('does not contain "free while in early access"', () => {
      const pricingPath1 = join(siteDir, "pricing.html");
      const pricingPath2 = join(siteDir, "pricing", "index.html");
      const pricingPath = existsSync(pricingPath1) ? pricingPath1 : pricingPath2;

      const pricing = readFileSync(pricingPath, "utf8");

      expect(
        pricing,
        'Pricing page must not contain "free while in early access"'
      ).not.toMatch(/free\s+while\s+in\s+early\s+access/i);

      expect(
        pricing,
        'Pricing page must not contain "free during early access"'
      ).not.toMatch(/free\s+during\s+early\s+access/i);
    });

    it('does not use "beta" to imply a price', () => {
      const pricingPath1 = join(siteDir, "pricing.html");
      const pricingPath2 = join(siteDir, "pricing", "index.html");
      const pricingPath = existsSync(pricingPath1) ? pricingPath1 : pricingPath2;

      const pricing = readFileSync(pricingPath, "utf8");

      expect(
        pricing,
        'Pricing page must not use "beta" to imply free access'
      ).not.toMatch(/free.*beta|beta.*free|free\s+while.*beta/i);
    });
  });

  describe("Constants alignment", () => {
    it("uses only the settled fee amounts (£2, £6, £10)", () => {
      const pricingPath1 = join(siteDir, "pricing.html");
      const pricingPath2 = join(siteDir, "pricing", "index.html");
      const pricingPath = existsSync(pricingPath1) ? pricingPath1 : pricingPath2;

      const pricing = readFileSync(pricingPath, "utf8");

      // Should NOT mention £4 (the old hard cap)
      expect(
        pricing,
        "Must not reference £4 fee (replaced by £6/£10 ladder)"
      ).not.toMatch(/£4(?!\d)/); // £4 not followed by another digit
    });

    it('states "three" free jobs, not "five"', () => {
      const homepage = readFileSync(join(siteDir, "index.html"), "utf8");

      // When talking about free jobs for new users, must say three
      // Should not say "first five jobs"
      expect(
        homepage,
        'Homepage must not say "first five jobs are free"'
      ).not.toMatch(/first\s+five\s+jobs.*free/i);

      // Positive check: must say three
      expect(
        homepage,
        'Homepage must say "three" in free jobs promise'
      ).toMatch(/three/i);
    });
  });
});
