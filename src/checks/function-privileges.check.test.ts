import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALLOWED_EXPOSURES } from "./public-surface-allowlist";
import {
  describeExposure,
  findUnsafeExposures,
  type FunctionPrivilege,
} from "./public-surface-core";

/**
 * No SECURITY DEFINER function in the public schema may be executable by
 * `anon`, `authenticated` or `PUBLIC` unless it is on the reviewed allowlist.
 *
 * A live check, so it asserts about PRODUCTION rather than about this tree and
 * runs from rls-check.yml with credentials — never in the gate, which has no
 * service-role key and must not have one (the repository is public).
 *
 * The decision logic lives in `public-surface-core.ts` and is covered by
 * `tests/regression/public-surface.test.ts`, which DOES run in the gate. This
 * file is only the part that needs a database.
 *
 * What it is for: `settle_fee_collection` sat on production for weeks — SECURITY
 * DEFINER, owned by postgres, callable by `anon`, able to mark fees paid and
 * clear a billing hold — while every gate stayed green. Nothing looked, because
 * every other check in this repository validates the tree against itself.
 */
describe("no unauthenticated function bypasses RLS on production", () => {
  it("every SECURITY DEFINER function is either revoked or allowlisted", async () => {
    // Fail loudly rather than skip. A check with no credentials has quietly
    // stopped existing, and reports success while doing it.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "Database credentials not configured — cannot verify function privileges on production",
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_public_function_privileges");

    if (error) {
      // The most likely cause by far, so name it: migration 56 creates this
      // function, and migrations reach production by hand via `supabase db
      // push`. Schema precedes code here, so a missing function means the
      // migration has not been applied yet.
      throw new Error(
        `Failed to read function privileges: ${error.message}. ` +
          "If this says the function does not exist, apply migration " +
          "00000000000056_public_surface_audit.sql to production first.",
      );
    }

    const rows = (data ?? []) as FunctionPrivilege[];

    // An empty result is not a pass. This project has functions; zero rows means
    // the reader is broken or pointed somewhere unexpected, and reading that as
    // "no exposures" is how a check silently stops checking.
    expect(rows.length, "check_public_function_privileges returned no rows").toBeGreaterThan(0);

    const unsafe = findUnsafeExposures(rows, ALLOWED_EXPOSURES);

    if (unsafe.length > 0) {
      throw new Error(
        `${unsafe.length} function(s) bypass RLS and are reachable without the service role:\n\n` +
          unsafe.map(describeExposure).join("\n\n") +
          "\n\nIf an exposure is deliberate, add it to src/checks/public-surface-allowlist.ts " +
          "with a reason and a ticket — that is a DECISION NEEDED-equivalent notice, not a way " +
          "to quiet the check.",
      );
    }

    expect(unsafe).toEqual([]);
  });

  it("every allowlisted exposure still exists, so the list cannot rot", async () => {
    // An entry for a function that no longer exists is worse than clutter: it
    // silently pre-authorises anything later created under that name.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Database credentials not configured — cannot verify the allowlist");
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_public_function_privileges");
    if (error) throw new Error(`Failed to read function privileges: ${error.message}`);

    const live = new Set(((data ?? []) as FunctionPrivilege[]).map((r) => r.function_name));
    const stale = ALLOWED_EXPOSURES.filter((a) => !live.has(a.function_name));

    if (stale.length > 0) {
      throw new Error(
        `Allowlist entries for functions that no longer exist on production: ` +
          `${stale.map((s) => s.function_name).join(", ")}. Remove them — an entry for a ` +
          `missing function pre-authorises whatever is next created under that name.`,
      );
    }

    expect(stale).toEqual([]);
  });
});
