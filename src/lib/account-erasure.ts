// Real, immediate account erasure.
//
// Replaces the soft-delete + 30-day purge this file's predecessor implemented.
// That scheme flagged `deleted_at`, scheduled a purge, signed the contractor
// out — and never touched the Supabase auth user. No read path filtered on the
// flag, so the account stayed fully functional: the contractor who deleted
// theirs on 2026-09-01 at 07:14 signed back in with the same password at 07:36.
// Re-signing-up with the address hit Supabase's existing-user path, which
// deliberately returns a success-shaped response and sends no confirmation
// email, so the missing email was the same bug wearing a different hat.
//
// Migration 17's stated reason for never deleting the auth user — that the
// ON DELETE CASCADE would take the financial records with it — was true when
// written and is no longer: migration 30 flipped invoices.quote_id and
// contracts.quote_id to ON DELETE RESTRICT, so the delete fails outright rather
// than destroying anything. Either way it could not be done; migration 61
// makes it possible by detaching the contractor row instead (ON DELETE SET
// NULL) rather than cascading it.
//
// Two properties do the work here, and both are load-bearing:
//
//   1. EVERY call's result is checked. supabase-js does NOT throw on a failed
//      query — it returns `{ error }` — so the previous implementation's
//      try/catch was unreachable for the failure it was written to catch, and
//      it stamped `purged_at` regardless. Each step below runs through `step()`,
//      which turns a returned error into a thrown ErasureFailure.
//   2. The auth user is deleted LAST. Every earlier step is either idempotent
//      or leaves the account usable, so a mid-sequence failure aborts with the
//      account intact and signed-in-able. The reverse order would leave an
//      orphaned pile of rows with no owner, which is the worst outcome (D2).

import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "./stripe";
import {
  closeConnectedAccount,
  getOutstandingFundsState,
  type OutstandingFunds,
} from "./stripe-connect";

// Buckets holding contractor-owned objects. Both are keyed by the owner's
// auth user id as the first path segment (see the storage policies in
// migrations 4 and 42), which is what makes a prefix listing safe here.
const OWNED_BUCKETS = ["logos", "receipts"] as const;

export type ErasureErrorCode =
  | "not_authenticated"
  | "no_account"
  | "outstanding_funds"
  | "stripe_unreachable"
  | "storage_failed"
  | "data_erase_failed"
  | "anonymise_failed"
  | "stripe_close_failed"
  | "auth_delete_failed";

// `alreadyErased` covers the idempotency case: a second erasure of an account
// that has none of its data left. In practice the second attempt rarely gets
// this far — deleting the auth user revokes every session, so the retry
// usually fails authentication before reaching here — but a concurrent double
// submit can, and it must succeed rather than error on work the first call did.
export type ErasureResult =
  | { ok: true; alreadyErased: boolean }
  | { ok: false; code: ErasureErrorCode; message: string; outstanding?: OutstandingFunds };

// Thrown internally by `step` so the orchestrator can abort at the first
// failure with a code the UI can act on. Never escapes eraseAccount.
class ErasureFailure extends Error {
  constructor(
    readonly code: ErasureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ErasureFailure";
  }
}

// The single choke point every database write goes through. supabase-js
// resolves rather than rejects on a query error, so an unchecked `await` on a
// PostgrestBuilder looks exactly like a success — this is the whole reason the
// previous purge could stamp itself complete having scrubbed nothing.
const step = async <T>(
  code: ErasureErrorCode,
  label: string,
  run: () => PromiseLike<{ error: { message: string } | null; data?: T }>,
): Promise<void> => {
  const { error } = await run();
  if (error) throw new ErasureFailure(code, `${label}: ${error.message}`);
};

/**
 * Checks the one thing that may legitimately block an erasure: money still in
 * flight (D5). Everything else — an incomplete profile, unsent drafts, an open
 * quote — is the contractor's own business and never blocks.
 *
 * A Stripe outage blocks too, deliberately. An unverifiable precondition is not
 * a satisfied one, and proceeding would close an account still holding funds.
 */
export const checkErasurePreconditions = async (
  stripeAccountId: string | null,
): Promise<ErasureResult> => {
  // No connected account means no Stripe balance and no pending payout, so
  // there is nothing that could be outstanding. Skip rather than fail.
  if (!stripeAccountId || !stripe) return { ok: true, alreadyErased: false };

  const funds = await getOutstandingFundsState(stripeAccountId);
  if (funds === null) {
    return {
      ok: false,
      code: "stripe_unreachable",
      message:
        "We couldn't reach Stripe to check whether you have money on its way to you. " +
        "Nothing has been deleted — please try again in a few minutes.",
    };
  }

  if (funds.pennies > 0) {
    return { ok: false, code: "outstanding_funds", message: describeOutstanding(funds), outstanding: funds };
  }

  return { ok: true, alreadyErased: false };
};

// The blocked message names the amount and when it should settle, because
// "you can't delete this yet" without either is a dead end rather than a route
// back (D5).
export const describeOutstanding = (funds: OutstandingFunds): string => {
  const amount = `£${(funds.pennies / 100).toFixed(2)}`;
  const when = funds.expectedArrival
    ? `It should reach your bank by ${funds.expectedArrival}.`
    : "It'll be paid out on your usual Stripe schedule.";
  return (
    `You still have ${amount} on its way to you from Stripe, so we can't close the account yet. ` +
    `${when} Come back once it's landed and you'll be able to delete straight away.`
  );
};

/**
 * Erases an account for good. Ordered so the auth identity — the thing whose
 * survival caused the original defect — goes last, and so a failure at any
 * earlier step leaves a working account rather than a half-deleted one.
 *
 * @param admin  service-role client; RLS would otherwise block most of this,
 *               and the auth admin API is service-role-only by definition.
 */
export const eraseAccount = async (
  admin: SupabaseClient,
  input: { userId: string; contractorId: string | null; stripeAccountId: string | null },
): Promise<ErasureResult> => {
  const { userId, contractorId, stripeAccountId } = input;

  try {
    if (contractorId) {
      await eraseContractorScopedData(admin, contractorId, userId);
      await voidOutstandingArtefacts(admin, contractorId);
      await anonymiseRetainedRecords(admin, contractorId);
    }

    await eraseUserScopedData(admin, userId);
    await eraseStorageObjects(admin, userId);

    // Closing the connected account is deliberately the last reversible-ish
    // step before the auth delete: if it fails, the account is scrubbed but
    // still owned, so a retry completes rather than orphaning a live Stripe
    // account against an identity that no longer exists (D7).
    if (stripeAccountId) {
      const closed = await closeConnectedAccount(stripeAccountId);
      if (!closed) {
        throw new ErasureFailure(
          "stripe_close_failed",
          "Stripe would not close the connected account",
        );
      }
    }

    // Last. Deleting this detaches the contractor row (owner_user_id becomes
    // null via ON DELETE SET NULL, migration 61) rather than cascading the
    // financial records away, and invalidates every session and refresh token
    // the identity held — which is what makes the old password stop working.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      throw new ErasureFailure("auth_delete_failed", `auth user: ${error.message}`);
    }

    return { ok: true, alreadyErased: false };
  } catch (error) {
    if (error instanceof ErasureFailure) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
};

// Everything hanging off the contractor that carries personal, operational or
// learned data and has no retention obligation behind it (D4). Deleted
// outright, not scrubbed: a row with every field nulled is still a row that
// says this account existed and did this much work.
const eraseContractorScopedData = async (
  admin: SupabaseClient,
  contractorId: string,
  userId: string,
): Promise<void> => {
  const wipes: [string, string][] = [
    ["knowledge_chunks", "contractor_id"],
    ["team_members", "contractor_id"],
    ["merchant_accounts", "contractor_id"],
    ["rate_cards", "contractor_id"],
    ["contractor_material_prices", "contractor_id"],
    ["counterparties", "contractor_id"],
    ["quote_line_edits", "contractor_id"],
    // Analytics identifiers, per D4. Deleted rather than de-identified: the
    // properties blob carries free text from across the app and cannot be
    // shown to be PII-free field by field.
    ["events", "contractor_id"],
  ];

  for (const [table, column] of wipes) {
    await step("data_erase_failed", `delete ${table}`, () =>
      admin.from(table).delete().eq(column, contractorId),
    );
  }

  // Voice artefacts and free-text intake data. The rows themselves stay —
  // invoices and contracts chain through jobs, so removing them would take the
  // retained financial record with them — but everything a person said, and
  // every name and address they said it about, goes.
  await step("data_erase_failed", "scrub jobs", () =>
    admin
      .from("jobs")
      .update({
        transcript: null,
        extracted_json: null,
        conversation_json: [],
        sow_json: null,
      })
      .eq("contractor_id", contractorId),
  );

  // The trade's customers are the trade's personal data about other people.
  // Nothing retains them, so the row survives only as an unnamed anchor for
  // the quote chain.
  await step("data_erase_failed", "scrub customers", () =>
    admin
      .from("customers")
      .update({ name: "Deleted customer", contact: {} })
      .eq("contractor_id", contractorId),
  );

  // Receipt images are about to be deleted from storage; the pointers must go
  // with them or the ledger renders broken links against an erased account.
  await step("data_erase_failed", "scrub job cost evidence", () =>
    admin.from("job_costs").update({ evidence_url: null }).eq("contractor_id", contractorId),
  );

  await step("data_erase_failed", "delete events by user", () =>
    admin.from("events").delete().eq("user_id", userId),
  );
};

// Rows keyed on the auth user rather than the contractor. Push subscriptions
// are APNs device tokens — D4 names them explicitly.
const eraseUserScopedData = async (admin: SupabaseClient, userId: string): Promise<void> => {
  await step("data_erase_failed", "delete push subscriptions", () =>
    admin.from("push_subscriptions").delete().eq("user_id", userId),
  );
  await step("data_erase_failed", "delete notification preferences", () =>
    admin.from("notification_preferences").delete().eq("user_id", userId),
  );
};

/**
 * D6 — outstanding sendable artefacts are withdrawn rather than left live.
 *
 * An unsigned contract sitting in a customer's inbox and an unpaid invoice both
 * carry a public link. Erasing the trade behind them without voiding them would
 * leave a customer holding a working link to a document nobody can honour.
 * Signed contracts and paid invoices are NOT touched — those are the records D3
 * retains.
 */
const voidOutstandingArtefacts = async (
  admin: SupabaseClient,
  contractorId: string,
): Promise<void> => {
  const { data: quoteRows, error: quoteError } = await admin
    .from("quotes")
    .select("id, job:jobs!inner(contractor_id)")
    .eq("jobs.contractor_id", contractorId);

  if (quoteError) {
    throw new ErasureFailure("data_erase_failed", `read quotes: ${quoteError.message}`);
  }

  const quoteIds = (quoteRows ?? []).map((q) => (q as { id: string }).id);
  if (quoteIds.length === 0) return;

  // Only `status`. contracts.status_changed_at is GENERATED ALWAYS AS
  // (coalesce(signed_at, declined_at)) — Postgres rejects any write to it with
  // "column can only be updated to DEFAULT", so setting it alongside the status
  // fails the whole statement. It needs no help: voiding does not sign or
  // decline the contract, so the derived value is correctly left as it was.
  //
  // This was found by running the erasure against production, not by the tests
  // below: the stub client accepts any column name, so a payload naming a
  // generated column looks identical to a valid one. Worth remembering for the
  // next update written against a table nobody has hand-checked.
  await step("data_erase_failed", "void unsigned contracts", () =>
    admin.from("contracts").update({ status: "void" }).in("quote_id", quoteIds).is("signed_at", null),
  );

  await step("data_erase_failed", "void unpaid invoices", () =>
    admin.from("invoices").update({ status: "void" }).in("quote_id", quoteIds).is("paid_at", null),
  );

  // Draft and unsent quotes are erased outright rather than voided: nothing
  // retains an unsent quote, and its line items carry the site address and the
  // customer's name in free text (D4).
  await step("data_erase_failed", "erase unsent quotes", () =>
    admin
      .from("quotes")
      .update({ line_items_json: [], drafted_line_items_json: null, contractor_flags_json: [] })
      .in("id", quoteIds)
      .is("sent_at", null),
  );
};

/**
 * D3 — what stays, and what it may not say.
 *
 * Issued invoices, payment records, signed contracts and the fee ledger are
 * retained under GDPR Art 17(3)(b) against HMRC record retention. They stay
 * queryable for reporting; what goes is every trace of who the trade was.
 *
 * The pseudonymous key is the contractor row's own `id`. It is already a random
 * uuid with no derivation from the identity, and once `owner_user_id` is null
 * (which the auth delete does, via ON DELETE SET NULL) there is no join path
 * from it back to the erased user — which is the whole of §4.2's third
 * constraint. Nothing is hashed from the email, because a hash of personal
 * data is still personal data (D1).
 */
const anonymiseRetainedRecords = async (
  admin: SupabaseClient,
  contractorId: string,
): Promise<void> => {
  // The rendered contract body and its variable bag are the one retained place
  // the trade's own name, address and business name appear as free text. The
  // signed record survives; the letterhead does not.
  const { data: contractRows, error: contractError } = await admin
    .from("contracts")
    .select("id, quote:quotes!inner(job:jobs!inner(contractor_id))")
    .eq("quotes.jobs.contractor_id", contractorId);

  if (contractError) {
    throw new ErasureFailure("anonymise_failed", `read contracts: ${contractError.message}`);
  }

  const contractIds = (contractRows ?? []).map((c) => (c as { id: string }).id);
  if (contractIds.length > 0) {
    await step("anonymise_failed", "anonymise contracts", () =>
      admin
        .from("contracts")
        .update({ rendered_body: null, variables_json: {}, job_input_json: {} })
        .in("id", contractIds),
    );
  }

  // The contractor row itself becomes the pseudonymous shell. Rates and markup
  // go with the identity — they are the trade's commercial position, not a
  // financial record — while the row's id keeps the invoice chain resolvable.
  await step("anonymise_failed", "anonymise contractor", () =>
    admin
      .from("contractors")
      .update({
        company_name: "Erased account",
        first_name: null,
        company_number: null,
        vat_number: null,
        trade: null,
        branding: {},
        business_profile: {},
        day_rate: null,
        overtime_rate: null,
        callout_min: null,
        travel_rate: null,
        markup_pct: null,
        payout_account_holder_name: null,
        payout_sort_code: null,
        payout_account_number: null,
        referral_code: null,
        stripe_account_id: null,
        erased_at: new Date().toISOString(),
      })
      .eq("id", contractorId),
  );
};

// Storage objects are keyed by the owner's auth user id as the first path
// segment. Listing then removing is two round trips, but the storage API has no
// delete-by-prefix, and a bucket that silently keeps a voice recording is the
// exact gap the old purge left: it nulled jobs.source_audio_url and left the
// audio itself sitting in the bucket, unreferenced and unfindable.
const eraseStorageObjects = async (admin: SupabaseClient, userId: string): Promise<void> => {
  for (const bucket of OWNED_BUCKETS) {
    const { data: files, error: listError } = await admin.storage.from(bucket).list(userId, {
      limit: 1000,
    });

    if (listError) {
      throw new ErasureFailure("storage_failed", `list ${bucket}: ${listError.message}`);
    }
    if (!files || files.length === 0) continue;

    const paths = files.map((file) => `${userId}/${file.name}`);
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) {
      throw new ErasureFailure("storage_failed", `remove from ${bucket}: ${removeError.message}`);
    }
  }
};
