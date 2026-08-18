import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Real contractors, owned by real auth users, for the live integration lane.
 *
 * WHY THIS EXISTS. Three test files each built their own fixture and each got
 * the same two things wrong: they inserted `business_name`, which is not a
 * column on `contractors` (it is `company_name`), and they set
 * `owner_user_id` to a string like `test-user-a-1755…`, which is a uuid column
 * with a foreign key to `auth.users`. Every insert failed, every `data!.id`
 * threw `Cannot read properties of null`, and the cross-tenant security proof
 * never ran once.
 *
 * The fix belongs in one place. An RLS test needs a genuine auth user anyway —
 * the whole point is to authenticate as contractor B and be refused — so
 * creating the user and the contractor together is the only correct order.
 */

export interface TestContractor {
  contractorId: string;
  authUserId: string;
  email: string;
  password: string;
}

/** Anything the caller can pass a Supabase error to. */
function must<T>(what: string, data: T | null, error: { message: string } | null): T {
  // Checked, not asserted away. `data!.id` on a failed insert reports
  // "Cannot read properties of null", which is indistinguishable between a
  // missing table, a bad column, a constraint violation and a permissions
  // problem — three live runs were spent establishing what this one line says.
  if (error) throw new Error(`${what} failed: ${error.message}`);
  if (data === null) throw new Error(`${what} returned no row and no error`);
  return data;
}

export async function createTestContractor(
  admin: SupabaseClient,
  prefix: string,
): Promise<TestContractor> {
  const email = `${prefix}-${Date.now()}-${Math.round(performance.now() * 1000)}@example.test`;
  const password = `pw-${prefix}-${Date.now()}`;

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const authUser = must("creating the auth user", created?.user ?? null, authError);

  const { data: contractor, error: insertError } = await admin
    .from("contractors")
    .insert({
      // `company_name`, not `business_name`. The latter is on no migration.
      company_name: `${prefix}-contractor`,
      owner_user_id: authUser.id,
    })
    .select("id")
    .single();

  const row = must("inserting the contractor", contractor, insertError);
  return { contractorId: row.id, authUserId: authUser.id, email, password };
}

/**
 * Remove what a run created. Costs and jobs go before contractors, because
 * job_costs.job_id is ON DELETE RESTRICT — the behaviour LED-1 exists to add,
 * which would otherwise make cleanup fail on its own feature.
 */
export async function destroyTestContractor(
  admin: SupabaseClient,
  contractor: TestContractor,
): Promise<void> {
  const { data: jobs } = await admin
    .from("jobs")
    .select("id")
    .eq("contractor_id", contractor.contractorId);

  for (const job of jobs ?? []) {
    await admin.from("job_costs").delete().eq("job_id", job.id);
  }
  await admin.from("jobs").delete().eq("contractor_id", contractor.contractorId);
  await admin.from("counterparties").delete().eq("contractor_id", contractor.contractorId);
  await admin.from("contractors").delete().eq("id", contractor.contractorId);
  await admin.auth.admin.deleteUser(contractor.authUserId);
}
