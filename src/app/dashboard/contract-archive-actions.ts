"use server";

import { createClient } from "@/lib/supabase/server";

// Archiving a resolved contract hides it from the dashboard. It never deletes
// it, and it never touches the contract itself.
//
// Both actions write exactly one column, `archived_at`. Nothing here reads or
// writes `status`, `signer_name`, `signed_at` or `declined_at`, and there is no
// delete: a signed contract is a legal artefact, and the point of this feature
// is to tidy a list without touching the record the list points at.
//
// The user's own client, NOT the admin client. Every other write in this
// directory goes through createAdminClient because it runs on behalf of a
// CUSTOMER following a link — nobody is signed in, so RLS has nobody to scope
// to. This runs for a signed-in contractor acting on their own dashboard, so
// the session client is both sufficient and the thing that enforces ownership:
// contracts' "Owner scoped via quote" policy (migration 020) resolves quote ->
// job -> contractor -> owner_user_id = auth.uid(), and a contract belonging to
// another account is not visible to update in the first place. Reaching for the
// admin client here would bypass exactly the check that makes this safe.

// Idempotent by construction. `archive` filters on `archived_at is null` and
// `restore` on `is not null`, so a repeat call matches no row and changes
// nothing rather than overwriting the original timestamp with a later one — the
// same shape as the state-machine guards on sign and decline.
const setArchived = async (contractId: string, archivedAt: string | null) => {
  const supabase = await createClient();

  const query = supabase
    .from("contracts")
    .update({ archived_at: archivedAt })
    .eq("id", contractId);

  const { error } = archivedAt
    ? await query.is("archived_at", null)
    : await query.not("archived_at", "is", null);

  // Thrown rather than returned. The caller archives optimistically — the row
  // is already gone from the screen by the time this resolves — so a silent
  // failure would leave the list showing a state the database does not have.
  if (error) throw new Error(error.message);
};

/** Hide a signed or declined contract from the dashboard list. Reversible. */
export const archiveContract = async (contractId: string) => {
  await setArchived(contractId, new Date().toISOString());
};

/** Put an archived contract back on the dashboard list. */
export const restoreContract = async (contractId: string) => {
  await setArchived(contractId, null);
};
