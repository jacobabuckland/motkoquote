#!/usr/bin/env tsx

/**
 * Re-render unsigned contracts stored before the 13 Sep contract fixes.
 *
 * WHY. `contracts.rendered_body` is written once, at creation, and never again.
 * The fixes that landed in #720 — the inverted labour/materials split, the
 * Materials clause opening mid-thought, the `(**No**)` cancellation artefact,
 * the ink execution block — therefore reach new contracts only. The rows
 * already in production still say what they said, and at least one of them is
 * sitting in front of a customer who has not signed yet, showing
 * `Labour £0.00` against the full price of an all-labour job.
 *
 * WHAT IT WILL NOT TOUCH. Signed contracts, ever — that document is the
 * agreement, and correcting it after execution is not a backfill. Erased
 * accounts. Contracts whose quote has been edited since they were sent (the
 * subtotal gate in `planContractRepair`). Anything that already renders
 * identically.
 *
 * WHAT IT RECOMPUTES. Three variables: `labour_cost`, `materials_cost`,
 * `materials_statement`. Everything else in `variables_json` — the contract
 * date, the price, the scope, the client's details — is passed through
 * unchanged. It never rebuilds the variables from the live quote.
 *
 * A deliberate two-step, matching create-missing-subscriptions.ts:
 *   - Bare invocation lists what it WOULD repair, and writes nothing.
 *   - `--confirm` writes.
 *
 * RUNNABLE: npx tsx scripts/backfill/repair-contract-bodies.ts --confirm
 *
 * Usage:
 *   npx tsx scripts/backfill/repair-contract-bodies.ts                    # list only
 *   npx tsx scripts/backfill/repair-contract-bodies.ts --contract <id>    # scope to one
 *   npx tsx scripts/backfill/repair-contract-bodies.ts --confirm          # write
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
  planContractRepair,
  type RepairPlan,
  type StoredContract,
} from "../../src/lib/contracts/repair-stored-contract";

config({ path: resolve(process.cwd(), ".env.local") });

const USAGE = `repair-contract-bodies — re-render unsigned contracts stored before the 13 Sep fixes

  npx tsx scripts/backfill/repair-contract-bodies.ts                  list what would change
  npx tsx scripts/backfill/repair-contract-bodies.ts --contract <id>  scope to one contract
  npx tsx scripts/backfill/repair-contract-bodies.ts --confirm        apply

Never touches a signed contract. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`;

type ContractQueryRow = {
  id: string;
  template_key: StoredContract["template_key"];
  status: string;
  signed_at: string | null;
  rendered_body: string | null;
  variables_json: StoredContract["variables_json"];
  job_input_json: { materials_by?: string | null } | null;
  quote: {
    line_items_json: StoredContract["line_items"];
    job: { contractor: { vat_registered: boolean } | null } | null;
  } | null;
};

export const toStoredContract = (row: ContractQueryRow): StoredContract => ({
  id: row.id,
  template_key: row.template_key,
  status: row.status,
  signed_at: row.signed_at,
  rendered_body: row.rendered_body,
  variables_json: row.variables_json,
  materials_by: row.job_input_json?.materials_by ?? null,
  line_items: row.quote?.line_items_json ?? null,
  vat_registered: row.quote?.job?.contractor?.vat_registered ?? false,
});

const fetchContracts = async (
  supabase: SupabaseClient,
  contractId: string | null,
): Promise<ContractQueryRow[]> => {
  let query = supabase
    .from("contracts")
    .select(
      "id, template_key, status, signed_at, rendered_body, variables_json, job_input_json, quote:quotes(line_items_json, job:jobs(contractor:contractors(vat_registered)))",
    )
    // Narrowed in the query as well as in the planner. Two independent guards
    // on the one thing that must never happen.
    .is("signed_at", null);
  if (contractId) query = query.eq("id", contractId);

  const { data, error } = await query;
  if (error) throw new Error(`Could not read contracts: ${error.message}`);
  return (data ?? []) as unknown as ContractQueryRow[];
};

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const confirm = argv.includes("--confirm");
  const contractIndex = argv.indexOf("--contract");
  const contractId = contractIndex >= 0 ? (argv[contractIndex + 1] ?? null) : null;
  if (contractIndex >= 0 && !contractId) {
    console.error("--contract needs a contract id.\n");
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
  const rows = await fetchContracts(supabase, contractId);
  const plans: RepairPlan[] = rows.map((row) => planContractRepair(toStoredContract(row)));

  const repairs = plans.filter((plan): plan is Extract<RepairPlan, { action: "repair" }> =>
    plan.action === "repair",
  );
  const skips = plans.filter((plan) => plan.action === "skip");

  console.log(`${rows.length} unsigned contract(s) read.`);
  for (const plan of repairs) {
    console.log(`  REPAIR ${plan.id} — ${plan.fixes.join(", ")}`);
  }
  // Skips are counted by reason rather than listed: "quote-moved" is the one
  // worth a human's attention, and it should be rare.
  const byReason = new Map<string, number>();
  for (const plan of skips) {
    if (plan.action !== "skip") continue;
    byReason.set(plan.reason, (byReason.get(plan.reason) ?? 0) + 1);
  }
  for (const [reason, count] of byReason) console.log(`  skip ${reason}: ${count}`);

  if (!confirm) {
    console.log(`\n${repairs.length} contract(s) would be repaired. Re-run with --confirm to apply.`);
    return;
  }

  let written = 0;
  for (const plan of repairs) {
    const { error } = await supabase
      .from("contracts")
      .update({ variables_json: plan.variables, rendered_body: plan.renderedBody })
      // Re-asserted at write time: a contract signed between the read above and
      // this update must not be written.
      .eq("id", plan.id)
      .is("signed_at", null);
    if (error) {
      console.error(`  FAILED ${plan.id}: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    written += 1;
  }
  console.log(`\n${written} contract(s) repaired.`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
