import type { SupabaseClient } from "@supabase/supabase-js";

// Best-effort mutual exclusion for money-moving crons, backed by the cron_locks
// table (name is the PRIMARY KEY). Acquiring is an insert: it succeeds for the
// first runner and conflicts for any overlapping run. If the insert conflicts we
// reclaim the lock only when the existing row is older than the TTL — i.e. it
// was abandoned by a crashed run — so a genuinely concurrent run backs off.
//
// This sits on top of the fee_collections unique index, which is the definitive
// exactly-once guarantee; the lock simply stops overlapping runs doing redundant
// work at all.
const LOCK_TTL_MS = 10 * 60 * 1000;

export const acquireCronLock = async (
  admin: SupabaseClient,
  name: string,
  now: Date = new Date(),
): Promise<boolean> => {
  const nowIso = now.toISOString();
  const { error } = await admin.from("cron_locks").insert({ name, locked_at: nowIso });
  if (!error) return true;

  // Insert conflicted: a lock row already exists. Take it over only if stale.
  const staleBefore = new Date(now.getTime() - LOCK_TTL_MS).toISOString();
  const { data: reclaimed } = await admin
    .from("cron_locks")
    .update({ locked_at: nowIso })
    .eq("name", name)
    .lt("locked_at", staleBefore)
    .select("name");
  return Boolean(reclaimed && reclaimed.length > 0);
};

export const releaseCronLock = async (
  admin: SupabaseClient,
  name: string,
): Promise<void> => {
  await admin.from("cron_locks").delete().eq("name", name);
};
