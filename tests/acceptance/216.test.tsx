import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

describe("Issue #216: Stripe Connect Express onboarding for contractors", () => {
  describe("Stripe integration infrastructure", () => {
    it("has stripe package in dependencies", () => {
      const packageJson = JSON.parse(
        readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };

      expect(packageJson.dependencies).toHaveProperty("stripe");
    });

    it("creates src/lib/stripe.ts with Stripe client configuration", async () => {
      const stripeLib = await import("@/lib/stripe");

      // Should export a configured Stripe client or initialization function
      expect(stripeLib).toBeDefined();
      expect(
        typeof stripeLib === "object" || typeof stripeLib === "function",
      ).toBe(true);
    });

    it("creates src/lib/stripe-connect.ts with connected account functions", async () => {
      const stripeConnect = await import("@/lib/stripe-connect");

      // Core functions for Connect onboarding
      expect(stripeConnect.createConnectedAccount).toBeDefined();
      expect(typeof stripeConnect.createConnectedAccount).toBe("function");

      expect(stripeConnect.createAccountLink).toBeDefined();
      expect(typeof stripeConnect.createAccountLink).toBe("function");

      expect(stripeConnect.refreshAccountStatus).toBeDefined();
      expect(typeof stripeConnect.refreshAccountStatus).toBe("function");

      expect(stripeConnect.isOnboardingComplete).toBeDefined();
      expect(typeof stripeConnect.isOnboardingComplete).toBe("function");
    });

    it("uses test mode keys in test environment", async () => {
      const stripeLib = await import("@/lib/stripe");

      // In test environment, Stripe keys should be test keys (sk_test_) not live (sk_live_)
      // The module should either export a testMode flag or the key check should be in the config
      const testMode =
        "testMode" in stripeLib
          ? stripeLib.testMode
          : process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_");

      expect(testMode).toBe(true);
    });
  });

  describe("Webhook handling", () => {
    it("creates /api/stripe/webhook route", async () => {
      const webhookRoute = await import("@/app/api/stripe/webhook/route");

      // Should export POST handler
      expect(webhookRoute.POST).toBeDefined();
      expect(typeof webhookRoute.POST).toBe("function");
    });

    it("adds /api/stripe/webhook to PUBLIC_API_ROUTES", () => {
      const middlewarePath = resolve(
        process.cwd(),
        "src/lib/supabase/middleware.ts",
      );
      const content = readFileSync(middlewarePath, "utf8");

      expect(content).toContain("/api/stripe/webhook");
      expect(content).toMatch(/PUBLIC_API_ROUTES/);
    });
  });

  describe("Settings UI for contractor onboarding", () => {
    it("creates StripeConnectSection component", async () => {
      const stripeConnectSection = await import(
        "@/app/settings/stripe-connect-section"
      );

      expect(stripeConnectSection.StripeConnectSection).toBeDefined();
    });

    it("creates stripe-connect-actions with server actions", async () => {
      const actions = await import("@/app/settings/stripe-connect-actions");

      expect(actions.startStripeOnboarding).toBeDefined();
      expect(typeof actions.startStripeOnboarding).toBe("function");

      expect(actions.refreshStripeStatus).toBeDefined();
      expect(typeof actions.refreshStripeStatus).toBe("function");
    });

    it("includes StripeConnectSection in settings page", () => {
      const settingsPath = resolve(
        process.cwd(),
        "src/app/settings/page.tsx",
      );
      const content = readFileSync(settingsPath, "utf8");

      expect(content).toMatch(/StripeConnectSection|stripe-connect-section/);
    });

    it("queries stripe_account_id and capability flags in settings page", () => {
      const settingsPath = resolve(
        process.cwd(),
        "src/app/settings/page.tsx",
      );
      const content = readFileSync(settingsPath, "utf8");

      // Settings page should query Stripe columns from contractors table
      expect(content).toMatch(/stripe_account_id/);
      expect(content).toMatch(/stripe_payouts_enabled|stripe.*enabled/);
    });
  });

  describe("Migration for Stripe Connect schema", () => {
    it("documents or adds columns for Stripe Connect onboarding state", () => {
      // Migration 00000000000021 already added stripe_account_id, stripe_charges_enabled,
      // stripe_payouts_enabled, stripe_requirements_due. This ticket may add more columns
      // or just document activation of existing ones.

      const migrationsDir = resolve(process.cwd(), "supabase/migrations");
      const files = readdirSync(migrationsDir).join("\n");

      // Either migration 021 exists with the base columns, or a new migration 036 adds more
      const hasMigration021 = files.includes(
        "00000000000021_stripe_connect_payouts.sql",
      );
      const hasMigration036 = files.includes(
        "00000000000036_stripe_onboarding",
      );

      expect(hasMigration021 || hasMigration036).toBe(true);
    });

    it("migration 021 contains stripe_account_id column definition", () => {
      const migration021Path = resolve(
        process.cwd(),
        "supabase/migrations/00000000000021_stripe_connect_payouts.sql",
      );
      const content = readFileSync(migration021Path, "utf8");

      expect(content).toContain("stripe_account_id");
      expect(content).toMatch(/alter table contractors add column/i);
    });
  });

  describe("Onboarding state tracking", () => {
    it("implements isOnboardingComplete predicate", async () => {
      const stripeConnect = await import("@/lib/stripe-connect");

      // Test the predicate with a mock contractor record
      const completeContractor = {
        stripe_account_id: "acct_test123",
        stripe_payouts_enabled: true,
        stripe_charges_enabled: false,
        stripe_requirements_due: false,
      };

      const incompleteContractor = {
        stripe_account_id: "acct_test456",
        stripe_payouts_enabled: false,
        stripe_charges_enabled: false,
        stripe_requirements_due: false,
      };

      const noAccountContractor = {
        stripe_account_id: null,
        stripe_payouts_enabled: false,
        stripe_charges_enabled: false,
        stripe_requirements_due: false,
      };

      expect(stripeConnect.isOnboardingComplete(completeContractor)).toBe(
        true,
      );
      expect(stripeConnect.isOnboardingComplete(incompleteContractor)).toBe(
        false,
      );
      expect(stripeConnect.isOnboardingComplete(noAccountContractor)).toBe(
        false,
      );
    });
  });

  describe("Payment link gating (forward-looking for PAY-3)", () => {
    it("provides a function or check to gate payment link generation on onboarding status", async () => {
      const stripeConnect = await import("@/lib/stripe-connect");

      // Should export a guard function that can be called before generating payment links
      // This may be isOnboardingComplete or a separate canGeneratePaymentLink function
      const hasGuard =
        "isOnboardingComplete" in stripeConnect ||
        "canGeneratePaymentLinks" in stripeConnect ||
        "canAcceptPayments" in stripeConnect;

      expect(hasGuard).toBe(true);
    });
  });

  describe("Environment variable configuration", () => {
    it("documents STRIPE_SECRET_KEY in .env.example", () => {
      const envExample = readFileSync(
        resolve(process.cwd(), ".env.example"),
        "utf8",
      );

      expect(envExample).toContain("STRIPE_SECRET_KEY");
    });

    it("documents STRIPE_WEBHOOK_SECRET in .env.example", () => {
      const envExample = readFileSync(
        resolve(process.cwd(), ".env.example"),
        "utf8",
      );

      expect(envExample).toContain("STRIPE_WEBHOOK_SECRET");
    });
  });

  describe("Onboarding states in UI", () => {
    it("StripeConnectSection handles not started state (null stripe_account_id)", async () => {
      await import("@/app/settings/stripe-connect-section");
      const componentSource = readFileSync(
        resolve(
          process.cwd(),
          "src/app/settings/stripe-connect-section.tsx",
        ),
        "utf8",
      );

      // Should check for null stripe_account_id and show "Connect" or "Start onboarding" UI
      expect(componentSource).toMatch(
        /stripe_account_id.*null|!stripe_account_id/,
      );
      expect(componentSource).toMatch(/Connect|Start.*onboarding/i);
    });

    it("StripeConnectSection handles in progress state", async () => {
      const componentSource = readFileSync(
        resolve(
          process.cwd(),
          "src/app/settings/stripe-connect-section.tsx",
        ),
        "utf8",
      );

      // Should check for stripe_account_id set but payouts not enabled
      expect(componentSource).toMatch(
        /stripe_payouts_enabled.*false|!stripe_payouts_enabled/,
      );
      expect(componentSource).toMatch(/Complete|Continue.*onboarding/i);
    });

    it("StripeConnectSection handles complete state", async () => {
      const componentSource = readFileSync(
        resolve(
          process.cwd(),
          "src/app/settings/stripe-connect-section.tsx",
        ),
        "utf8",
      );

      // Should show Connected or Ready status when payouts enabled
      expect(componentSource).toMatch(/stripe_payouts_enabled.*true/);
      expect(componentSource).toMatch(/Connected|Ready/i);
    });

    it("StripeConnectSection handles requirements outstanding state", async () => {
      const componentSource = readFileSync(
        resolve(
          process.cwd(),
          "src/app/settings/stripe-connect-section.tsx",
        ),
        "utf8",
      );

      // Should check stripe_requirements_due and show action required
      expect(componentSource).toMatch(/stripe_requirements_due/);
      expect(componentSource).toMatch(/Action required|requirements/i);
    });
  });

  describe("Re-entry support for abandoned onboarding", () => {
    it("createAccountLink accepts stripeAccountId to generate fresh link for existing account", async () => {
      const stripeConnect = await import("@/lib/stripe-connect");

      // createAccountLink should accept an account ID (for re-entry) and return URL
      // We can't test the actual implementation, but we can verify the signature
      expect(stripeConnect.createAccountLink).toBeDefined();
      expect(stripeConnect.createAccountLink.length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  describe("Webhook signature verification", () => {
    it("webhook route verifies Stripe signature before processing", async () => {
      const webhookSource = readFileSync(
        resolve(process.cwd(), "src/app/api/stripe/webhook/route.ts"),
        "utf8",
      );

      // Should use stripe.webhooks.constructEvent or similar verification
      expect(webhookSource).toMatch(/webhook.*verify|constructEvent/i);
      expect(webhookSource).toMatch(/STRIPE_WEBHOOK_SECRET/);
    });

    it("webhook route returns 400 on invalid signature", async () => {
      const webhookSource = readFileSync(
        resolve(process.cwd(), "src/app/api/stripe/webhook/route.ts"),
        "utf8",
      );

      // Should return error response on signature verification failure
      expect(webhookSource).toMatch(/400|unauthorized|invalid.*signature/i);
    });
  });

  describe("Capability configuration: bank only, no cards", () => {
    it("createConnectedAccount requests transfers capability, not card_payments", async () => {
      const stripeConnectSource = readFileSync(
        resolve(process.cwd(), "src/lib/stripe-connect.ts"),
        "utf8",
      );

      // Should request transfers/bank capability
      expect(stripeConnectSource).toMatch(/transfers|payouts|bank/i);

      // Should NOT request card_payments capability (or explicitly exclude it)
      // Absense is okay, but if capabilities are listed, card_payments should not be there
      const hasCardPayments = /card_payments/.test(stripeConnectSource);
      if (hasCardPayments) {
        // If card_payments appears, it should be in a negative context (comment, exclusion)
        expect(stripeConnectSource).toMatch(
          /no.*card|not.*card|card.*false|card.*disabled/i,
        );
      }
    });
  });

  describe("Account.updated webhook handling", () => {
    it("webhook route handles account.updated event type", async () => {
      const webhookSource = readFileSync(
        resolve(process.cwd(), "src/app/api/stripe/webhook/route.ts"),
        "utf8",
      );

      expect(webhookSource).toMatch(/account\.updated/);
    });

    it("webhook updates capability flags in contractors table", async () => {
      const webhookSource = readFileSync(
        resolve(process.cwd(), "src/app/api/stripe/webhook/route.ts"),
        "utf8",
      );

      // Should update the three capability boolean columns
      expect(webhookSource).toMatch(/stripe_charges_enabled/);
      expect(webhookSource).toMatch(/stripe_payouts_enabled/);
      expect(webhookSource).toMatch(/stripe_requirements_due/);
    });

    it("webhook maps account ID to contractor record", async () => {
      const webhookSource = readFileSync(
        resolve(process.cwd(), "src/app/api/stripe/webhook/route.ts"),
        "utf8",
      );

      // Should query contractors by stripe_account_id
      expect(webhookSource).toMatch(/stripe_account_id/);
      expect(webhookSource).toMatch(/from.*contractors|contractors.*where/i);
    });
  });

  describe("Return URL after Stripe-hosted onboarding", () => {
    it("createAccountLink sets return URL to /settings", async () => {
      const stripeConnectSource = readFileSync(
        resolve(process.cwd(), "src/lib/stripe-connect.ts"),
        "utf8",
      );

      expect(stripeConnectSource).toMatch(/\/settings/);
      expect(stripeConnectSource).toMatch(/return.*url|refresh.*url/i);
    });
  });

  describe("Status refresh on page load (webhook delivery fallback)", () => {
    it("settings page calls refreshStripeStatus when account exists but payouts not enabled", () => {
      const settingsSource = readFileSync(
        resolve(process.cwd(), "src/app/settings/page.tsx"),
        "utf8",
      );

      // Should have logic similar to TrueLayer mandate refresh (lines 50-61 in current file)
      // Checks for stripe_account_id set but stripe_payouts_enabled false, then refreshes
      expect(settingsSource).toMatch(/refreshStripeStatus|refreshAccountStatus/);
      expect(settingsSource).toMatch(/stripe_account_id/);
      expect(settingsSource).toMatch(/stripe_payouts_enabled/);
    });
  });
});
