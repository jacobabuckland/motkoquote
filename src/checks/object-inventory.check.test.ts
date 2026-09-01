import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findInventoryDrift,
  renderManifest,
  type PublicObject,
} from "./public-surface-core";

/**
 * Production's public schema must match the manifest committed in this tree.
 *
 * The migration ledger cannot do this job. It records which FILES were run, not
 * what is actually in the database, so it agrees with itself whether or not the
 * DDL landed — and it says nothing at all about an object created outside the
 * migration flow.
 *
 * Both directions are failures, for opposite reasons:
 *
 *   unexpected — something reached production without passing through this
 *   repository. `settle_fee_collection` exactly: created by hand, present in no
 *   migration, called by no code, unnoticed for weeks.
 *
 *   missing — the tree expects an object production does not have. The ghost
 *   apply CLAUDE.md warns about, where a migration is recorded as applied but
 *   its DDL never landed.
 *
 * A live check: it runs from rls-check.yml with credentials, never in the gate.
 */
describe("production's public schema matches the committed manifest", () => {
  it("has no unexpected objects, and none missing", async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "Database credentials not configured — cannot verify production's object inventory",
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_public_object_inventory");

    if (error) {
      throw new Error(
        `Failed to read the object inventory: ${error.message}. ` +
          "If this says the function does not exist, apply migration " +
          "00000000000056_public_surface_audit.sql to production first.",
      );
    }

    const live = (data ?? []) as PublicObject[];

    // Zero rows is a broken reader, not an empty database.
    expect(live.length, "check_public_object_inventory returned no rows").toBeGreaterThan(0);

    const manifest = JSON.parse(
      readFileSync("src/checks/public-surface.json", "utf8"),
    ) as PublicObject[];

    const { unexpected, missing } = findInventoryDrift(live, manifest);

    if (unexpected.length > 0 || missing.length > 0) {
      const lines: string[] = [];

      if (unexpected.length > 0) {
        lines.push(
          `On production but NOT in the manifest — these reached the database without ` +
            `passing through this repository:`,
          ...unexpected.map((o) => `  + ${o.object_kind} ${o.object_name}`),
          "",
          `Each needs a migration that creates it, or dropping. If it is a function, check ` +
            `its privileges too: function-privileges.check.test.ts covers SECURITY DEFINER, ` +
            `but a hand-created object has had no review at all.`,
        );
      }

      if (missing.length > 0) {
        lines.push(
          `In the manifest but NOT on production — the tree expects these and the database ` +
            `does not have them:`,
          ...missing.map((o) => `  - ${o.object_kind} ${o.object_name}`),
          "",
          `A migration recorded as applied whose DDL never landed looks exactly like this. ` +
            `The ledger is not proof; confirm the object itself.`,
        );
      }

      // Printed so the fix is a copy-paste, while still landing as a reviewed
      // commit — which is where a human actually sees what appeared. A check
      // that says "wrong" and leaves you to rebuild the file by hand is one
      // people learn to skip.
      lines.push("", "Manifest matching production as it stands now:", renderManifest(live));

      throw new Error(lines.join("\n"));
    }

    expect({ unexpected, missing }).toEqual({ unexpected: [], missing: [] });
  });
});
