import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";

// Checker rule (#221): all tables in the public schema must have row level
// security enabled. Query pg_catalog.pg_class.relrowsecurity to assert every
// table has RLS on. If any table lacks RLS, report it and fail — this surfaces
// a security gap that must be addressed separately.

describe("RLS enabled on all public tables", () => {
  it("all tables in public schema have row level security enabled", async () => {
    // Fail loudly if database connection is not configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Database credentials not configured - cannot verify RLS status");
    }

    const admin = createAdminClient();

    // Query pg_catalog to get all tables in public schema and their RLS status
    // Uses check_public_tables_rls() function created in migration 039
    const { data, error } = await admin.rpc("check_public_tables_rls");

    if (error) {
      throw new Error(`Failed to query pg_class for RLS status: ${error.message}`);
    }

    // Parse the result - expect array of {table_name, rls_enabled}
    const tables = (data || []) as Array<{ table_name: string; rls_enabled: boolean }>;

    // Find tables without RLS
    const tablesWithoutRls = tables.filter((t) => !t.rls_enabled);

    // Assert all tables have RLS enabled - if this fails, the error message
    // will show which tables lack RLS
    if (tablesWithoutRls.length > 0) {
      const tableNames = tablesWithoutRls.map((t) => t.table_name).join(", ");
      throw new Error(
        `The following tables in the public schema do not have RLS enabled: ${tableNames}. ` +
        `Each needs its own policy review before enabling RLS.`
      );
    }

    expect(tablesWithoutRls).toEqual([]);
  });
});
