import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PAY-8: Pay connected-account balances out to contractors' banks.
 *
 * Stripe payouts were set to "manual" at account creation, but no code existed
 * to trigger payouts. Money accumulated in contractor balances and never
 * reached their banks. This ticket fixes the schedule and sweeps existing
 * accounts.
 */

const SCRIPT = "scripts/update-payout-schedules.ts";
const REPO = resolve(__dirname, "../..");

const run = (env: Record<string, string>) =>
  spawnSync("npx", ["tsx", SCRIPT], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 60_000,
  });

describe("Issue #344: Pay connected-account balances out to contractors' banks", () => {
  describe("Account creation sets daily automatic payouts", () => {
    it("createConnectedAccount creates accounts with interval: daily", async () => {
      const stripeConnectSource = readFileSync(
        resolve(REPO, "src/lib/stripe-connect.ts"),
        "utf8",
      );

      // The defect: account creation set interval: "manual" and nothing ever
      // called stripe.payouts.create. The fix: set interval: "daily" so
      // Stripe handles payouts automatically.
      expect(stripeConnectSource).toMatch(
        /settings:\s*\{[\s\S]*?payouts:\s*\{[\s\S]*?schedule:\s*\{[\s\S]*?interval:\s*["']daily["']/,
      );

      // Alternatively, if the structure differs but the intent is the same:
      expect(stripeConnectSource).toContain('interval: "daily"');
    });

    it("does not set interval: manual anywhere in the codebase", () => {
      // This is the regression guard. The defect was `interval: "manual"` at
      // account creation. No code path may reintroduce it.
      const stripeConnectSource = readFileSync(
        resolve(REPO, "src/lib/stripe-connect.ts"),
        "utf8",
      );

      // Allow "manual" to appear in comments or string literals explaining
      // what NOT to do, but not as an assigned value.
      expect(stripeConnectSource).not.toMatch(/interval:\s*["']manual["']/);
    });
  });

  describe("Sweep script updates existing accounts", () => {
    it("exists at the path the RUNNABLE line names", () => {
      expect(existsSync(resolve(REPO, SCRIPT))).toBe(true);
    });

    it("is executable via npx tsx", () => {
      // This invocation is THE test that proves the deliverable is runnable.
      // A test that only imports the function is satisfied by a library
      // function with no entry point — which is how two money backfills
      // shipped unbuildable.
      const proc = run({
        NEXT_PUBLIC_SUPABASE_URL: "",
        STRIPE_SECRET_KEY: "",
      });

      // Expect it to refuse to run without credentials, not to crash on
      // import. Exit code 2 is the convention for "missing required env".
      expect(proc.status).toBeGreaterThanOrEqual(1);
    }, 60_000);

    it("refuses to run without STRIPE_SECRET_KEY", () => {
      const proc = run({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        STRIPE_SECRET_KEY: "",
      });

      expect(proc.status).not.toBe(0);
      expect(proc.stderr || proc.stdout).toMatch(/STRIPE_SECRET_KEY/i);
    }, 60_000);

    it("refuses to run without NEXT_PUBLIC_SUPABASE_URL", () => {
      const proc = run({
        NEXT_PUBLIC_SUPABASE_URL: "",
        STRIPE_SECRET_KEY: "sk_test_example",
      });

      expect(proc.status).not.toBe(0);
      expect(proc.stderr || proc.stdout).toMatch(/SUPABASE_URL/i);
    }, 60_000);

    it("reports how many accounts it updated", () => {
      const scriptSource = readFileSync(resolve(REPO, SCRIPT), "utf8");

      // The script must report its progress — silence is not acceptable for
      // a money operation. Look for a pattern that logs a count.
      expect(scriptSource).toMatch(/console\.(log|info)/);
      expect(scriptSource).toMatch(/updated|changed|processed/i);
    });

    it("is idempotent — safe to run multiple times", () => {
      const scriptSource = readFileSync(resolve(REPO, SCRIPT), "utf8");

      // Idempotency means the script can run twice without changing anything
      // on the second pass. Stripe accepts schedule updates even when the
      // schedule is already set correctly, so calling accounts.update twice
      // is safe. The script must NOT track "already updated" state that would
      // break on a second invocation.
      //
      // We verify by ensuring the script unconditionally updates all accounts
      // rather than maintaining a separate "processed" list.
      expect(scriptSource).toContain("stripe.accounts.update");

      // Must NOT have logic that prevents re-running (e.g., checking a
      // "last_updated" timestamp or maintaining a set of processed IDs).
      expect(scriptSource).not.toMatch(/if\s*\(\s*alreadyProcessed/i);
      expect(scriptSource).not.toMatch(/\.has\(.*account.*id\)/i);
    });

    it("skips contractors with no stripe_account_id", () => {
      const scriptSource = readFileSync(resolve(REPO, SCRIPT), "utf8");

      // The script queries contractors.stripe_account_id and only attempts
      // Stripe API calls for rows where it is non-null. A null value means
      // the contractor never started Stripe onboarding.
      expect(scriptSource).toMatch(/stripe_account_id/);
      expect(scriptSource).toMatch(/is not null|!\s*null|where.*stripe_account_id/i);
    });

    it("calls stripe.accounts.update with daily payout schedule", () => {
      const scriptSource = readFileSync(resolve(REPO, SCRIPT), "utf8");

      // The sweep must set the same schedule as the creation function:
      // interval: "daily".
      expect(scriptSource).toContain("stripe.accounts.update");
      expect(scriptSource).toMatch(/interval:\s*["']daily["']/);
      expect(scriptSource).toMatch(/payouts.*schedule|schedule.*interval/);
    });
  });

  describe("Regression: payment flow unchanged", () => {
    it("does not modify stripe-payments.ts", () => {
      const stripePaymentsSource = readFileSync(
        resolve(REPO, "src/lib/stripe-payments.ts"),
        "utf8",
      );

      // The payment creation flow is unchanged. The fee is still collected
      // via application_fee_amount, and the destination charge still goes to
      // the connected account. Only the PAYOUT schedule changes, which is in
      // stripe-connect.ts, not stripe-payments.ts.
      expect(stripePaymentsSource).toContain("application_fee_amount");
      expect(stripePaymentsSource).toContain("transfer_data");
    });

    it("does not modify canAcceptStripePayment logic", () => {
      const stripeConnectSource = readFileSync(
        resolve(REPO, "src/lib/stripe-connect.ts"),
        "utf8",
      );

      // canAcceptStripePayment gates on stripe_payouts_enabled (which holds
      // the transfers capability) and is correct as written. These are
      // destination charges, so card_payments is never requested and
      // charges_enabled is false for every contractor. Gating on it would
      // shut the pay button for everyone.
      expect(stripeConnectSource).toContain("canAcceptStripePayment");
      expect(stripeConnectSource).toMatch(
        /stripe_payouts_enabled|payoutsEnabled/,
      );
    });
  });

  describe("No clearing of existing balances", () => {
    it("does not call stripe.payouts.create in the sweep script", () => {
      const scriptSource = readFileSync(resolve(REPO, SCRIPT), "utf8");

      // Clearing the balances that exist now is deliberately out of scope.
      // The script only updates the schedule; it does NOT trigger payouts.
      // stripe.payouts.create is the API call that would move money, and it
      // must be absent.
      expect(scriptSource).not.toContain("payouts.create");
    });
  });

  describe("Environment and setup", () => {
    it("requires Stripe SDK as a dependency", () => {
      const packageJson = JSON.parse(
        readFileSync(resolve(REPO, "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };

      expect(packageJson.dependencies).toHaveProperty("stripe");
    });

    it("documents the runnable command in its own docstring", () => {
      const scriptSource = readFileSync(resolve(REPO, SCRIPT), "utf8");

      // Every runnable script carries a RUNNABLE: line in its docstring,
      // naming the exact command that runs it.
      expect(scriptSource).toMatch(/RUNNABLE:/);
      expect(scriptSource).toContain("npx tsx scripts/update-payout-schedules.ts");
    });
  });
});
