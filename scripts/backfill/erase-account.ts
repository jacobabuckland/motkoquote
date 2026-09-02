/**
 * Erase one account through the real erasure path, from the command line.
 *
 * Exists for the accounts stranded by the pre-migration-57 delete path: they
 * were flagged `deleted_at`, their auth user was never touched, and their purge
 * was scheduled onto a cron that no longer exists. Signing in and pressing
 * Delete again would work, but it means holding the password for an account you
 * have already tried to delete — so this does the same thing, against the same
 * code, without the UI.
 *
 * It calls eraseAccount directly. There is no second implementation to drift:
 * the ordering, the result checks, the Stripe close and the auth delete are all
 * the ones the app uses, so anything true of the button is true of this.
 *
 * RUNNABLE: npx tsx scripts/backfill/erase-account.ts --user <uuid>
 *
 * Dry run by default — it reports what it would remove and exits without
 * touching anything. Add --confirm to actually erase.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, plus
 * STRIPE_SECRET_KEY when the account has a connected account. Migration 57 must
 * already be applied: without it contractors.owner_user_id is still NOT NULL
 * with ON DELETE CASCADE, and the auth delete fails on the retention foreign
 * keys rather than detaching the row.
 */

import { createClient } from "@supabase/supabase-js";
import { checkErasurePreconditions, eraseAccount } from "../../src/lib/account-erasure";

const args = process.argv.slice(2);
const userId = args[args.indexOf("--user") + 1];
const confirm = args.includes("--confirm");

if (!args.includes("--user") || !userId || userId.startsWith("--")) {
  console.error("Usage: npx tsx scripts/backfill/erase-account.ts --user <uuid> [--confirm]");
  process.exit(2);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required.",
  );
  process.exit(2);
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const main = async (): Promise<void> => {
  // Confirm the auth user is really there before anything else. On a stranded
  // account this is the whole point: the row the old path left behind.
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError || !authUser?.user) {
    console.error(
      `No auth user ${userId} — nothing to erase. (${authError?.message ?? "not found"})`,
    );
    process.exit(1);
  }

  const { data: contractor, error: contractorError } = await admin
    .from("contractors")
    .select("id, stripe_account_id, deleted_at, erased_at")
    .eq("owner_user_id", userId)
    .maybeSingle();

  // A read failure is not "no account". Erasing the auth user of an account
  // whose data we never managed to look at is exactly the half-deleted state
  // this work exists to make unreachable.
  if (contractorError) {
    console.error(`Could not read the contractor row: ${contractorError.message}`);
    process.exit(1);
  }

  const stripeAccountId = (contractor?.stripe_account_id as string | null) ?? null;

  console.log(`Auth user:   ${userId} (created ${authUser.user.created_at})`);
  console.log(`Contractor:  ${contractor?.id ?? "none"}`);
  console.log(`Stripe:      ${stripeAccountId ?? "no connected account"}`);
  if (contractor?.deleted_at) {
    console.log(`Stranded:    flagged deleted_at ${contractor.deleted_at} under the old path`);
  }
  if (contractor?.erased_at) {
    console.log(`Note:        already marked erased at ${contractor.erased_at}`);
  }

  // D5 — money still in flight is the only thing that blocks, and it is checked
  // in the dry run too. A precondition you only discover at execution time is
  // not much of a precondition.
  const preconditions = await checkErasurePreconditions(stripeAccountId);
  if (!preconditions.ok) {
    console.error(`\nBLOCKED (${preconditions.code}): ${preconditions.message}`);
    process.exit(1);
  }
  console.log("Preconditions: clear — nothing outstanding at Stripe.");

  if (!confirm) {
    console.log("\nDry run. Nothing has been changed. Re-run with --confirm to erase.");
    return;
  }

  console.log("\nErasing…");
  const result = await eraseAccount(admin, {
    userId,
    contractorId: (contractor?.id as string | undefined) ?? null,
    stripeAccountId,
  });

  if (!result.ok) {
    // The account is intact — every step aborts before the auth delete.
    console.error(`\nFAILED (${result.code}): ${result.message}`);
    console.error("The account has NOT been erased and is still usable. Fix the cause and re-run.");
    process.exit(1);
  }

  // Prove it rather than announce it. The original defect was a path that
  // reported success having done nothing.
  const { data: after } = await admin.auth.admin.getUserById(userId);
  if (after?.user) {
    console.error("\nERROR: erasure reported success but the auth user still exists.");
    process.exit(1);
  }

  console.log("Done. The auth user is gone and the retained records are anonymised.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
