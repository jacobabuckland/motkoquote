import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The migration is applied by a human, so what it promises is pinned here:
// every PA table has RLS on and is owner-scoped, a pending action can only be
// born unspent, and a message cannot be planted in another contractor's thread.
const sql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/00000000000086_pa_conversation_store.sql"),
  "utf8",
);

const TABLES = ["pa_threads", "pa_messages", "pa_pending_actions", "pa_draft_assumptions"];

describe("migration 86", () => {
  it.each(TABLES)("%s is created with row level security", (table) => {
    expect(sql).toMatch(new RegExp(`create table ${table} \\(`));
    expect(sql).toMatch(new RegExp(`alter table ${table} enable row level security`));
  });

  it.each(TABLES)("%s has policies and every one is scoped through contractors.owner_user_id = auth.uid()", (table) => {
    const policies = sql
      .split(";")
      .filter((statement) => new RegExp(`create policy "[^"]+" on ${table} `).test(statement));
    expect(policies.length).toBeGreaterThanOrEqual(3);
    for (const policy of policies) {
      expect(policy).toMatch(/owner_user_id = auth\.uid\(\)/);
    }
  });

  it("a pending action can only be inserted unspent, in a thread the contractor owns", () => {
    const insert = sql
      .split(";")
      .find((statement) => /create policy "Owner inserts own pending actions"/.test(statement))!;
    expect(insert).toMatch(/confirmed_at is null/);
    expect(insert).toMatch(/thread_id in \(/);
  });

  it("a message can only be inserted into a thread the contractor owns", () => {
    const insert = sql
      .split(";")
      .find((statement) => /create policy "Owner inserts own messages"/.test(statement))!;
    expect(insert).toMatch(/thread_id in \(/);
  });

  it("a pending action's only permitted UPDATE is confirmed_at going null -> now", () => {
    const fn = sql.slice(sql.indexOf("create function pa_pending_actions_claim_only"));
    const body = fn.slice(0, fn.indexOf("$$;", 20));
    expect(body).toMatch(/old\.confirmed_at is not null/);
    expect(body).toMatch(/new\.confirmed_at is null/);
    for (const column of ["thread_id", "contractor_id", "action", "args", "summary", "expires_at"]) {
      expect(body, column).toMatch(new RegExp(`new\\.${column} is distinct from old\\.${column}`));
    }
    expect(sql).toMatch(/create trigger pa_pending_actions_claim_only\s+before update on pa_pending_actions/);
    expect(body).toMatch(/set search_path = ''/);
  });

  it("assumptions rows and threads cannot be re-pointed at another job or contractor", () => {
    expect(sql).toMatch(/new\.job_id is distinct from old\.job_id/);
    expect(sql).toMatch(/create trigger pa_draft_assumptions_frozen_keys\s+before update on pa_draft_assumptions/);
    expect(sql).toMatch(/create trigger pa_threads_frozen_owner\s+before update on pa_threads/);
  });

  it("is additive: no drops, no alters of existing tables", () => {
    expect(sql).not.toMatch(/drop (table|column)/i);
    expect(sql).not.toMatch(/alter table (?!pa_)/);
  });
});
