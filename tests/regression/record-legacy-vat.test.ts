// The legacy VAT backfill: the judgement it makes, and the command that runs it.
//
// This writes money onto rows a customer has already been billed against, so
// the two things worth pinning are that it recovers the split correctly on the
// shapes production actually holds, and that it REFUSES on everything else
// rather than apportioning something it cannot justify.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planLegacyQuoteVat, sumLineItems } from "@/lib/backfill/legacy-vat-record";
import type { LineItem } from "@/lib/schemas/job";

// A whole LineItem, because a partial literal compiles nowhere and runs
// everywhere — vitest ignores the missing fields and only tsc objects.
const line = (overrides: Partial<LineItem> = {}): LineItem => ({
  description: "Works — see Scope of work",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 450,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...overrides,
});

const quote = (overrides: Partial<Parameters<typeof planLegacyQuoteVat>[0]> = {}) => ({
  id: "quote_1",
  total: 540,
  subtotal: null,
  vat_amount: null,
  vat_rate: null,
  line_items: [line()],
  ...overrides,
});

describe("what the backfill recovers", () => {
  it("splits a grossed-up total back into its subtotal and VAT", () => {
    // b3112196, reported 14 Sep: £450.00 of lines rendering under a £540.00
    // total with a live Accept button and nothing explaining the £90.
    const plan = planLegacyQuoteVat(quote(), []);
    expect(plan).toMatchObject({
      action: "record",
      shape: "grossed",
      lineItemSum: 450,
      subtotal: 450,
      vat_amount: 90,
      vat_rate: 0.2,
    });
  });

  it("asserts no VAT where the total already equals the lines", () => {
    // Written while the trade was not registered. Zero is what was charged,
    // and it is a different answer from "nobody wrote it down".
    const plan = planLegacyQuoteVat(quote({ total: 450 }), []);
    expect(plan).toMatchObject({ action: "record", shape: "net", subtotal: 450, vat_amount: 0 });
  });

  it("never writes a total — only what it is made of", () => {
    const plan = planLegacyQuoteVat(quote(), []);
    expect(plan).not.toHaveProperty("total");
  });

  it("absorbs per-line rounding rather than rejecting the row", () => {
    // 0fb6d475 on production: £3,570.04 of lines stored as £4,284.00, where
    // 3570.04 * 1.2 is 4284.048.
    const plan = planLegacyQuoteVat(
      quote({ total: 4284, line_items: [line({ unit_price: 3570.04 })] }),
      [],
    );
    expect(plan).toMatchObject({ action: "record", shape: "grossed", vat_amount: 713.96 });
  });
});

describe("what it refuses", () => {
  it("leaves a quote that already records its split alone", () => {
    // Including one whose recorded figures look odd. A backfill that can
    // restate a recorded number is the defect it exists to remove.
    const plan = planLegacyQuoteVat(quote({ subtotal: 1, vat_amount: 2 }), []);
    expect(plan).toEqual({ action: "skip", id: "quote_1", reason: "already-recorded" });
  });

  it("refuses a total its lines no longer reconcile with", () => {
    // A quote edited after its total was stored. Neither hypothesis holds, and
    // apportioning one anyway is exactly the guess this must not make.
    const plan = planLegacyQuoteVat(quote({ total: 700 }), []);
    expect(plan).toEqual({ action: "skip", id: "quote_1", reason: "indeterminate" });
  });

  it("refuses a quote with no priced lines to reconcile against", () => {
    const plan = planLegacyQuoteVat(quote({ line_items: [] }), []);
    expect(plan).toEqual({ action: "skip", id: "quote_1", reason: "no-line-items" });
  });

  it("refuses a quote with no stored total", () => {
    const plan = planLegacyQuoteVat(quote({ total: 0 }), []);
    expect(plan).toEqual({ action: "skip", id: "quote_1", reason: "no-stored-total" });
  });

  it("refuses a quote invoiced beyond its own total", () => {
    const plan = planLegacyQuoteVat(quote(), [
      { id: "inv_1", amount: 540, vat_amount: null },
      { id: "inv_2", amount: 540, vat_amount: null },
    ]);
    expect(plan).toEqual({ action: "skip", id: "quote_1", reason: "over-invoiced" });
  });
});

describe("what it writes onto the invoices", () => {
  it("apportions the quote's VAT across a deposit and its balance", () => {
    // 7076212e: £1,440 stored against £1,200 of lines, billed £360 + £1,080.
    const plan = planLegacyQuoteVat(
      quote({ total: 1440, line_items: [line({ unit_price: 1200 })] }),
      [
        { id: "inv_deposit", amount: 360, vat_amount: null },
        { id: "inv_balance", amount: 1080, vat_amount: null },
      ],
    );
    expect(plan).toMatchObject({ action: "record", vat_amount: 240 });
    if (plan.action !== "record") throw new Error("expected a record plan");
    expect(plan.invoices).toEqual([
      { id: "inv_deposit", vat_amount: 60, vat_rate: 0.2 },
      { id: "inv_balance", vat_amount: 180, vat_rate: 0.2 },
    ]);
  });

  it("makes the invoices sum to the quote's VAT even where both shares round up", () => {
    // Harriet's penny, arriving through the backfill rather than live: the
    // settling invoice takes the remainder, so the parts sum to the whole.
    const plan = planLegacyQuoteVat(
      quote({ total: 3620.28, line_items: [line({ unit_price: 3016.9 })] }),
      [
        { id: "inv_deposit", amount: 905.07, vat_amount: null },
        { id: "inv_balance", amount: 2715.21, vat_amount: null },
      ],
    );
    if (plan.action !== "record") throw new Error("expected a record plan");
    const summed = Math.round(plan.invoices.reduce((s, i) => s + i.vat_amount, 0) * 100) / 100;
    expect(summed).toBe(plan.vat_amount);
  });

  it("fills only the blanks, but allocates against what is already recorded", () => {
    // The recorded sibling is not rewritten, and the settling invoice's
    // remainder is computed against the real £60 rather than a re-derived one.
    const plan = planLegacyQuoteVat(
      quote({ total: 1440, line_items: [line({ unit_price: 1200 })] }),
      [
        { id: "inv_deposit", amount: 360, vat_amount: 60 },
        { id: "inv_balance", amount: 1080, vat_amount: null },
      ],
    );
    if (plan.action !== "record") throw new Error("expected a record plan");
    expect(plan.invoices).toEqual([{ id: "inv_balance", vat_amount: 180, vat_rate: 0.2 }]);
  });

  it("asserts zero VAT on the invoices of a quote that carries none", () => {
    const plan = planLegacyQuoteVat(quote({ total: 450 }), [
      { id: "inv_1", amount: 450, vat_amount: null },
    ]);
    if (plan.action !== "record") throw new Error("expected a record plan");
    expect(plan.invoices).toEqual([{ id: "inv_1", vat_amount: 0, vat_rate: 0.2 }]);
  });
});

describe("summing the lines", () => {
  it("prices a crew line from its crew, not its cached unit price", () => {
    // lineItemTotal ignores unit_price where `people` is present, and the
    // classification below depends on matching it exactly.
    const sum = sumLineItems([
      line({
        category: "labour",
        unit_price: 934.33,
        quantity: 24,
        people: [
          { label: "Owner", days: 10, day_rate: 340 },
          { label: "Apprentice", days: 10, day_rate: 100 },
        ],
      }),
    ]);
    expect(sum).toBe(4400);
  });
});

// The entry point, invoked as a person would invoke it. Two money backfills
// have shipped here as library functions with nothing to run.
const SCRIPT = "scripts/backfill/record-legacy-vat.ts";

type Run = { status: number; stdout: string; stderr: string };

const cache = new Map<string, Run>();

const spawn = (args: string[]): Run => {
  try {
    const stdout = execFileSync("npx", ["tsx", SCRIPT, ...args], {
      encoding: "utf8",
      cwd: resolve(__dirname, "../.."),
      // Not `...process.env`: a developer's own SUPABASE_URL would make the
      // credential test below pass for the wrong reason.
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: process.env.NODE_ENV ?? "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
};

const run = (args: string[]): Run => {
  const key = args.join(" ");
  const cached = cache.get(key);
  if (cached) return cached;
  const result = spawn(args);
  cache.set(key, result);
  return result;
};

describe("the deliverable exists as something you can run", () => {
  it("is a file", () => {
    expect(existsSync(resolve(__dirname, "../..", SCRIPT))).toBe(true);
  });

  it("runs, and says what it is for", () => {
    const { status, stdout } = run(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/record-legacy-vat/);
    expect(stdout).toMatch(/--confirm/);
  });

  it("states its two guarantees in its own usage", () => {
    // What an operator needs to read before running it against production.
    const { stdout } = run(["--help"]);
    expect(stdout).toMatch(/[Nn]ever overwrites a recorded figure/);
    expect(stdout).toMatch(/never writes quotes\.total/);
  });
}, 120_000);

describe("it refuses rather than crashing when it cannot reach the database", () => {
  it("names the missing credential and exits non-zero", () => {
    const { status, stderr } = run([]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/SUPABASE_URL/);
    expect(stderr).not.toMatch(/at .*\n.*at /);
  });

  it("refuses --quote with no id", () => {
    const { status, stderr } = run(["--quote"]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/--quote needs a quote id/);
  });
}, 120_000);
