import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { contractorsMissingSubscription } from "../../scripts/backfill/create-missing-subscriptions";

/**
 * The SUB-1 backfill, and the fact that it can actually be RUN.
 *
 * `createSubscriptionForContractor` is called from exactly one place —
 * `persistContractorSetup`. SUB-1 shipped 6 Sep; every contractor in production
 * completed setup before it. The only trigger had already fired for all of them
 * before the code existed, and `subscription_projection` is empty across the
 * whole database as a result. Nobody is subscribed and nothing in the product
 * can change that.
 *
 * AGENTS.md is explicit about the shape this must take: two money backfills
 * previously shipped as library functions with no entry point, every gate
 * green, and could not be invoked. So this test SPAWNS the script rather than
 * importing the function behind it.
 *
 * It runs without credentials on purpose. The script's first act is to refuse
 * when its environment is incomplete, so the entry point is exercised end to
 * end — argument parsing, imports, the refusal — without touching Stripe or a
 * database. The write path is guarded by --confirm and belongs to a human.
 */

const SCRIPT = resolve(__dirname, "../../scripts/backfill/create-missing-subscriptions.ts");

const run = (args: string[] = [], env: Record<string, string> = {}) =>
  spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_SUBSCRIPTION_PRICE_ID: "",
      ...env,
    },
  });

describe("the script is a real entry point", () => {
  it("runs, rather than being a library function nobody can invoke", () => {
    const result = run();
    // It got far enough to parse args, resolve its imports and reach its own
    // env check. A script that could not be invoked would fail differently —
    // a module resolution error, not this message.
    expect(result.stderr).toContain("NEXT_PUBLIC_SUPABASE_URL is not set");
    expect(result.status).toBe(1);
  });

  it("names the variable when a URL is malformed, rather than dying inside Supabase", () => {
    // The first real run failed with a stack trace ending in
    // `validateSupabaseUrl` — accurate, and it named nothing the reader could
    // go and fix. The check now happens here, where the variable has a name.
    const result = run([], { NEXT_PUBLIC_SUPABASE_URL: "ldapggtjnvjnabvzcebj" });

    expect(result.stderr).toContain("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
    expect(result.stderr).not.toContain("validateSupabaseUrl");
    expect(result.status).toBe(1);
  });

  it("refuses a PRODUCT id where a price id belongs, and says which is which", () => {
    // The real failure: STRIPE_SUBSCRIPTION_PRICE_ID held prod_VDLMpfcB6kaG1U,
    // and Stripe's own error — "No such price: 'prod_…'" — named neither the
    // variable nor the confusion. It surfaced once per contractor, eleven
    // Stripe round-trips in, after eleven customers had already been created.
    const result = run([], {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_SUBSCRIPTION_PRICE_ID: "prod_VDLMpfcB6kaG1U",
    });

    expect(result.stderr).toContain("must be a PRICE id, not a product id");
    expect(result.stderr).toContain("That is the PRODUCT id");
    expect(result.status).toBe(1);
  });

  it("refuses without the Stripe price id, the variable whose absence caused this", () => {
    // persistContractorSetup puts the whole subscription block behind
    // `if (subscriptionPriceId)`, so an unset price id means setup completes
    // and silently creates nothing. The backfill must not repeat that: it
    // stops loudly instead of reporting success having done nothing.
    const result = run([], {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      STRIPE_SECRET_KEY: "sk_test_x",
    });
    expect(result.stderr).toContain("STRIPE_SUBSCRIPTION_PRICE_ID is not set");
    expect(result.status).toBe(1);
  });
});

describe("who it selects", () => {
  const contractor = (over: Partial<Parameters<typeof contractorsMissingSubscription>[0][number]> = {}) => ({
    id: "c1",
    company_name: "Buckland Plastering",
    owner_user_id: "u1",
    ...over,
  });

  it("picks a contractor with completed setup and no subscription", () => {
    expect(contractorsMissingSubscription([contractor()], [])).toHaveLength(1);
  });

  it("skips one that already has a subscription", () => {
    expect(contractorsMissingSubscription([contractor()], ["c1"])).toEqual([]);
  });

  it("skips one that never completed setup", () => {
    // No company name means nothing to bill under, and setup would create the
    // subscription itself when they finish.
    expect(contractorsMissingSubscription([contractor({ company_name: null })], [])).toEqual([]);
    expect(contractorsMissingSubscription([contractor({ company_name: "   " })], [])).toEqual([]);
  });

  it("skips one with no owner account, since there is no email to bill", () => {
    expect(contractorsMissingSubscription([contractor({ owner_user_id: null })], [])).toEqual([]);
  });

  it("selects only the ones that need it, out of a mixed set", () => {
    const rows = [
      contractor({ id: "needs-one" }),
      contractor({ id: "has-one" }),
      contractor({ id: "no-setup", company_name: null }),
    ];
    expect(contractorsMissingSubscription(rows, ["has-one"]).map((c) => c.id)).toEqual([
      "needs-one",
    ]);
  });
});
