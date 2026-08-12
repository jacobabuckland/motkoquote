import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHECKLIST_PATH = join(
  process.cwd(),
  "APP_STORE_CHECKLIST.md",
);

describe("Issue #204: Reconcile APP_STORE_CHECKLIST.md against the current tree", () => {
  it("reads the checklist file", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("removes all Stripe references", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    // Case-insensitive search for "stripe"
    const stripeMatch = content.match(/stripe/gi);
    expect(stripeMatch).toBeNull();
  });

  it("describes TrueLayer as the payment provider", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    expect(content).toContain("TrueLayer");
  });

  it("describes TrueLayer Payments API for customer invoices", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    // Should mention Payments API or similar
    const hasPaymentsApi =
      content.includes("Payments API") ||
      content.includes("payments API") ||
      (content.includes("TrueLayer") && content.includes("pay-by-bank"));
    expect(hasPaymentsApi).toBe(true);
  });

  it("describes commercial VRP or cVRP for fee collection", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    const hasVrp =
      content.includes("commercial VRP") ||
      content.includes("cVRP") ||
      content.includes("VRP");
    expect(hasVrp).toBe(true);
  });

  it("updates smoke-test to reference pay-by-bank instead of Stripe", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    // Should reference pay-by-bank in the smoke-test section
    expect(content).toMatch(/pay.by.bank/i);
  });

  it("corrects the aps-environment note to reflect production is already set", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    // Should NOT claim aps-environment is currently "development"
    const hasDevelopmentClaim = content.includes(
      "currently `development`",
    );
    expect(hasDevelopmentClaim).toBe(false);
  });

  it("removes the stale Parallel (Jacob-owned) Stripe section", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    // The section header should not exist
    const hasStripeSection = content.includes(
      "Parallel (Jacob-owned) — Stripe Pay by Bank",
    );
    expect(hasStripeSection).toBe(false);
  });

  it("retains verified claims about privacy manifest", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    // Should still reference ITMS-91053 / privacy manifest / UserDefaults CA92.1
    const hasPrivacyManifestClaim =
      content.includes("ITMS-91053") ||
      content.includes("privacy manifest") ||
      content.includes("UserDefaults") ||
      content.includes("CA92.1");
    expect(hasPrivacyManifestClaim).toBe(true);
  });

  it("retains verified claims about export compliance", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    // Should still reference ITSAppUsesNonExemptEncryption
    expect(content).toMatch(/ITSAppUsesNonExemptEncryption/);
  });

  it("retains verified claims about microphone usage description", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    // Should still reference NSMicrophoneUsageDescription
    expect(content).toMatch(/NSMicrophoneUsageDescription/);
  });

  it("does not add new checklist items beyond corrections", () => {
    const content = readFileSync(CHECKLIST_PATH, "utf-8");
    // Count checkbox items (lines starting with - [ ])
    const checkboxCount = (content.match(/^- \[ \]/gm) ?? []).length;
    // Original checklist has approximately 25-30 checkbox items
    // After removing the stale Stripe section (3 items), should have ~22-27
    // We're not adding new items, so should be in that range or less
    expect(checkboxCount).toBeLessThan(35);
  });
});
