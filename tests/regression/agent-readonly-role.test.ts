import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// V4: the agent_readonly role reads real customer PII, so its blast radius is
// worth binding in a test rather than trusting to review.
//
// These are static assertions about the migration, not a live database check —
// the suite has no database. They catch the failure that matters: someone
// widening the grant later without the decision that would require.

const RAW = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "00000000000044_agent_readonly_role.sql",
  ),
  "utf8",
);

// Assert against executable SQL only. The migration's comments deliberately
// name `bypassrls` and show the out-of-band `... password '<generated>'` call,
// and a negative assertion that reads prose would fire on the explanation of
// why the thing is absent.
const MIGRATION = RAW.split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const GRANTED_TABLES = ["jobs", "quotes", "contracts", "invoices"];

// Tables that must never appear in a grant here. push_subscriptions is the
// sharp one — device_token and the VAPID p256dh/auth pair are live push
// credentials, not diagnostic data.
const WITHHELD_TABLES = [
  "push_subscriptions",
  "contractors",
  "customers",
  "team_members",
  "rate_cards",
  "knowledge_chunks",
  "merchant_accounts",
  "fee_collections",
  "credit_events",
  "referrals",
];

describe("V4 — agent_readonly is read-only and narrowly scoped", () => {
  it("grants select on exactly the four diagnostic tables", () => {
    const granted = [...MIGRATION.matchAll(/grant select on table ([a-z_]+)/g)].map(
      (match) => match[1],
    );

    expect(granted.sort()).toEqual([...GRANTED_TABLES].sort());
  });

  it("grants no privilege other than select and schema usage", () => {
    // Any grant of a write privilege — or a blanket `grant all` — is the thing
    // this role exists not to have.
    expect(MIGRATION).not.toMatch(/grant (insert|update|delete|truncate|all)\b/i);
  });

  it("never grants a withheld table", () => {
    for (const table of WITHHELD_TABLES) {
      expect(MIGRATION).not.toMatch(
        new RegExp(`grant [a-z ]+ on table ${table}\\b`, "i"),
      );
    }
  });

  it("scopes RLS with per-table select policies rather than bypassrls", () => {
    // bypassrls would lift the role above RLS on every table at once,
    // including the withheld ones, turning a later grant mistake into a much
    // larger exposure.
    expect(MIGRATION).not.toMatch(/bypassrls/i);

    for (const table of GRANTED_TABLES) {
      expect(MIGRATION).toMatch(
        new RegExp(`on ${table}\\s+for select to agent_readonly`, "i"),
      );
    }
  });

  it("creates the role without a login or a committed password", () => {
    expect(MIGRATION).toMatch(/create role agent_readonly nologin/i);
    // A password in a migration is a leaked credential once pushed.
    expect(MIGRATION).not.toMatch(/password\s+'/i);
  });

  it("does not let future tables inherit the grant", () => {
    expect(MIGRATION).toMatch(
      /alter default privileges in schema public revoke all on tables from agent_readonly/i,
    );
  });

  it("is documented in AGENTS.md with its limits", () => {
    const agents = readFileSync(join(process.cwd(), "AGENTS.md"), "utf8");

    expect(agents).toMatch(/# Database access/);
    expect(agents).toMatch(/agent_readonly/);
    expect(agents).toMatch(/read-only/i);
    // The PII exposure must stay stated, not quietly dropped in an edit.
    expect(agents).toMatch(/PII/);
    expect(agents).toMatch(/CAPABILITY\s+FAULT/);
  });
});
