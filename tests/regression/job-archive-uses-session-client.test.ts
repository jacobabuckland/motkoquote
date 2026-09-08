import { beforeEach, describe, expect, it, vi } from "vitest";

// JOB-1. Archiving a job must go through the SESSION-scoped Supabase client, so
// row-level security decides whose jobs a contractor may file away. The admin
// client holds the service role and bypasses RLS entirely: reaching for it here
// would let any signed-in contractor archive anyone's job by id, and nothing
// downstream would notice, because archiving looks identical either way to the
// person doing it.
//
// The frozen acceptance test for this reads the action's source and checks the
// string "createClient" appears. That cannot tell an IMPORT of a name from a
// USAGE of it (AGENTS.md, and #359 before it), so it passes just as happily
// when the admin client is the one actually called — which is precisely the
// defect it exists to catch. It also breaks on any correct rename.
//
// This asserts the same claim as behaviour instead: run the real action and
// observe which client it reached for. It fails when the admin client is used
// and survives any refactor that keeps using the session one.

const JOB_ID = "11111111-1111-4111-8111-111111111111";

type UpdateCall = { table: string; payload: Record<string, unknown> };

/**
 * Loads the archive actions with both Supabase clients stubbed, and reports
 * which one was constructed.
 *
 * Both factories are counted rather than only the admin one: a test that merely
 * shows the admin client was untouched would also pass if the action reached
 * for neither and silently did nothing.
 */
const loadActions = async () => {
  vi.resetModules();

  const updates: UpdateCall[] = [];
  let sessionClientCalls = 0;
  let adminClientCalls = 0;

  const client = {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        // archiveJob ends at .is(), restoreJob at .not(); both are awaited
        // directly, so each terminal has to resolve to a Supabase-shaped result.
        const result = { error: null };
        return {
          eq: () => ({
            is: async () => result,
            not: async () => result,
          }),
        };
      },
    }),
  };

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => {
      sessionClientCalls += 1;
      return client;
    },
  }));

  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => {
      adminClientCalls += 1;
      return client;
    },
  }));

  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));

  const mod = await import("@/app/jobs/[id]/job-archive-actions");

  return {
    archiveJob: mod.archiveJob,
    restoreJob: mod.restoreJob,
    updates,
    counts: () => ({ session: sessionClientCalls, admin: adminClientCalls }),
  };
};

describe("archiving a job is subject to row-level security", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("archiveJob reaches for the session client and never the admin one", async () => {
    const { archiveJob, counts } = await loadActions();

    await archiveJob(JOB_ID);

    // Both directions matter. The admin count failing to be zero is the defect;
    // the session count failing to be positive means the action did nothing at
    // all, and an assertion that only checked the first would call that a pass.
    expect(counts().admin, "archiveJob used the service-role client, which bypasses RLS").toBe(0);
    expect(counts().session, "archiveJob never opened a session-scoped client").toBeGreaterThan(0);
  });

  it("restoreJob reaches for the session client and never the admin one", async () => {
    const { restoreJob, counts } = await loadActions();

    await restoreJob(JOB_ID);

    expect(counts().admin, "restoreJob used the service-role client, which bypasses RLS").toBe(0);
    expect(counts().session, "restoreJob never opened a session-scoped client").toBeGreaterThan(0);
  });

  it("writes only to jobs, and only the archived_at field", async () => {
    // RLS protects the rows; this protects the blast radius. An archive that
    // also wrote status, or wrote to a second table, would be doing something
    // the contractor did not ask for and the policy was not written to cover.
    const { archiveJob, updates } = await loadActions();

    await archiveJob(JOB_ID);

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("jobs");
    expect(Object.keys(updates[0].payload)).toEqual(["archived_at"]);
    expect(typeof updates[0].payload.archived_at).toBe("string");
  });

  it("restoring clears archived_at rather than writing a new timestamp", async () => {
    const { restoreJob, updates } = await loadActions();

    await restoreJob(JOB_ID);

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("jobs");
    expect(updates[0].payload).toEqual({ archived_at: null });
  });
});
