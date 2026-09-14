#!/usr/bin/env tsx

/**
 * Record the VAT split on quotes written before migration 80, and on the
 * invoices raised against them.
 *
 * WHY. Those rows carry a `total` and nothing else, so four separate surfaces
 * are left guessing or silent:
 *
 *   - /q/[id] and the quote PDF render line items that do not sum to the total,
 *     with nothing to explain the gap and a live Accept button underneath
 *     (quote b3112196: £450.00 of lines under £540.00, reported 14 Sep).
 *   - Contracts generated from them state a subtotal that is really a gross.
 *   - "VAT collected (all time)" falls back to gross / 6 on every invoice with
 *     no recorded amount — right for the rows the old code grossed up, and an
 *     invention of ~£1,760 on the rows it did not.
 *   - "Owed (net)" nets unpaid invoices from the CURRENT registration flag,
 *     so it moves £450 to £375 on a quote that carries no VAT at all.
 *
 * All four are the same missing fact. The recovery rule lives in
 * `src/lib/backfill/legacy-vat-record.ts` — read the comment there before
 * changing anything here; it is where the reasoning is.
 *
 * WHAT IT WILL NOT TOUCH. Any quote that already records both `subtotal` and
 * `vat_amount`, whatever they say. Any quote whose total matches neither
 * hypothesis — that is a quote edited after its total was stored, and it is
 * reported rather than apportioned. Any invoice that already records a VAT
 * amount. `total` itself is never written: what the customer was charged does
 * not change here, only what we know about its composition.
 *
 * A deliberate two-step, matching repair-contract-bodies.ts:
 *   - Bare invocation lists what it WOULD write, and writes nothing.
 *   - `--confirm` writes.
 *
 * RUNNABLE: npx tsx scripts/backfill/record-legacy-vat.ts --confirm
 *
 * Usage:
 *   npx tsx scripts/backfill/record-legacy-vat.ts                 # dry run
 *   npx tsx scripts/backfill/record-legacy-vat.ts --quote <id>    # scope to one
 *   npx tsx scripts/backfill/record-legacy-vat.ts --confirm       # write
 *
 * Requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY. The MCP connector is read-only and cannot run the
 * write step, by design — this is applied by a human, like every other
 * production mutation.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import {
  planLegacyQuoteVat,
  type LegacyInvoice,
  type LegacyQuote,
  type QuoteVatPlan,
} from "../../src/lib/backfill/legacy-vat-record";
import type { LineItem } from "../../src/lib/schemas/job";

config({ path: resolve(process.cwd(), ".env.local") });

const USAGE = `record-legacy-vat — record the VAT split on pre-migration-80 quotes and their invoices

  npx tsx scripts/backfill/record-legacy-vat.ts               list what would be written
  npx tsx scripts/backfill/record-legacy-vat.ts --quote <id>  scope to one quote
  npx tsx scripts/backfill/record-legacy-vat.ts --confirm     apply

Never overwrites a recorded figure and never writes quotes.total.
Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`;

const gbp = (value: number): string =>
  value.toLocaleString("en-GB", { style: "currency", currency: "GBP" });

type QuoteQueryRow = {
  id: string;
  total: number | null;
  subtotal: number | null;
  vat_amount: number | null;
  vat_rate: number | null;
  line_items_json: LineItem[] | null;
  invoices: { id: string; amount: number; vat_amount: number | null; created_at: string }[] | null;
};

const fetchQuotes = async (
  supabase: SupabaseClient,
  quoteId?: string,
): Promise<QuoteQueryRow[]> => {
  const query = supabase
    .from("quotes")
    .select("id, total, subtotal, vat_amount, vat_rate, line_items_json, invoices(id, amount, vat_amount, created_at)")
    // The population this exists for. A row with a recorded subtotal is skipped
    // by the planner anyway; filtering here keeps the read to the rows in
    // question rather than the whole table.
    .is("subtotal", null);

  const { data, error } = await (quoteId ? query.eq("id", quoteId) : query);
  if (error) throw new Error(`Reading quotes: ${error.message}`);
  return (data ?? []) as QuoteQueryRow[];
};

const toLegacyQuote = (row: QuoteQueryRow): LegacyQuote => ({
  id: row.id,
  total: row.total ?? 0,
  subtotal: row.subtotal,
  vat_amount: row.vat_amount,
  vat_rate: row.vat_rate,
  line_items: row.line_items_json ?? [],
});

// Oldest first, so the deposit is allocated before the balance and the invoice
// that SETTLES the quote is the one that takes the remainder. Allocating in
// arbitrary order would still sum correctly but would put the odd penny on
// whichever row the database happened to return last.
const toLegacyInvoices = (row: QuoteQueryRow): LegacyInvoice[] =>
  [...(row.invoices ?? [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((invoice) => ({ id: invoice.id, amount: invoice.amount, vat_amount: invoice.vat_amount }));

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const confirm = args.includes("--confirm");
  const quoteFlag = args.indexOf("--quote");
  const quoteId = quoteFlag === -1 ? undefined : args[quoteFlag + 1];
  if (quoteFlag !== -1 && !quoteId) {
    console.error("--quote needs a quote id.\n");
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      `Missing credentials: ${!url ? "SUPABASE_URL" : "SUPABASE_SERVICE_ROLE_KEY"} is not set.\n`,
    );
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(url, key);
  const rows = await fetchQuotes(supabase, quoteId);
  const plans: QuoteVatPlan[] = rows.map((row) =>
    planLegacyQuoteVat(toLegacyQuote(row), toLegacyInvoices(row)),
  );

  const records = plans.filter((plan): plan is Extract<QuoteVatPlan, { action: "record" }> =>
    plan.action === "record",
  );
  const skips = plans.filter((plan) => plan.action === "skip");

  console.log(`${rows.length} quote(s) read with no recorded subtotal.\n`);

  // Every row is listed with its working, not just counted. This is money being
  // written to rows a customer has already been billed against, so the dry run
  // has to be checkable against a real document rather than believed.
  for (const plan of records) {
    console.log(
      `  ${plan.shape === "grossed" ? "GROSSED" : "NET    "} ${plan.id}` +
        `  lines ${gbp(plan.lineItemSum)} -> subtotal ${gbp(plan.subtotal)}` +
        ` + VAT ${gbp(plan.vat_amount)}`,
    );
    for (const invoice of plan.invoices) {
      console.log(`            invoice ${invoice.id}  VAT ${gbp(invoice.vat_amount)}`);
    }
  }

  const byReason = new Map<string, number>();
  for (const plan of skips) {
    if (plan.action !== "skip") continue;
    byReason.set(plan.reason, (byReason.get(plan.reason) ?? 0) + 1);
    // `indeterminate` means the quote's lines no longer reconcile with its
    // stored total under either hypothesis — a human should look at those, so
    // they are named rather than counted.
    if (plan.reason === "indeterminate") console.log(`  SKIP  ${plan.id} — indeterminate`);
  }
  if (byReason.size > 0) console.log("");
  for (const [reason, count] of byReason) console.log(`  skip ${reason}: ${count}`);

  const invoiceCount = records.reduce((sum, plan) => sum + plan.invoices.length, 0);

  if (!confirm) {
    console.log(
      `\n${records.length} quote(s) and ${invoiceCount} invoice(s) would be written.` +
        ` Re-run with --confirm to apply.`,
    );
    return;
  }

  let quotesWritten = 0;
  let invoicesWritten = 0;
  for (const plan of records) {
    const { error } = await supabase
      .from("quotes")
      .update({
        subtotal: plan.subtotal,
        vat_amount: plan.vat_amount,
        vat_rate: plan.vat_rate,
      })
      .eq("id", plan.id)
      // Re-asserted at write time: a quote that recorded its split between the
      // read above and this update must not be restated.
      .is("subtotal", null);
    if (error) {
      console.error(`  FAILED quote ${plan.id}: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    quotesWritten += 1;

    for (const invoice of plan.invoices) {
      const { error: invoiceError } = await supabase
        .from("invoices")
        .update({ vat_amount: invoice.vat_amount, vat_rate: invoice.vat_rate })
        .eq("id", invoice.id)
        .is("vat_amount", null);
      if (invoiceError) {
        console.error(`  FAILED invoice ${invoice.id}: ${invoiceError.message}`);
        process.exitCode = 1;
        continue;
      }
      invoicesWritten += 1;
    }
  }
  console.log(`\n${quotesWritten} quote(s) and ${invoicesWritten} invoice(s) written.`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
