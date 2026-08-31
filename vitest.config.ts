import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Live-database checks, which assert something about PRODUCTION rather
      // than about this tree. They need a service-role key, and the CI gate
      // deliberately does not have one — this repository is public, so its
      // Actions logs are world-readable and a service-role key must not be in
      // every pull-request run.
      //
      // Excluded from the default suite, NOT from CI: rls-check.yml runs this
      // on a schedule with credentials and fails loudly. A check with no runner
      // is a check that has quietly stopped existing, which is worse than one
      // that fails.
      // Named exactly, not by a `*.live.test.ts` convention: #221's shipped
      // acceptance test asserts this path in five places, and renaming the file
      // to fit a nicer convention breaks the contract of an item that has
      // already merged. Another live check means another line here and in
      // vitest.live.config.ts.
      "src/checks/rls.check.test.ts",
      // The production-surface checks, added by the same rule the comment above
      // states: another live check means another line here and in
      // vitest.live.config.ts. Both need the service-role key.
      "src/checks/function-privileges.check.test.ts",
      "src/checks/object-inventory.check.test.ts",
      // Integration tests against a real database, for the same reason and by
      // the same arrangement. #244's cross-tenant tests gate on
      // SUPABASE_SERVICE_ROLE_KEY and `it.skipIf` themselves away without it,
      // so in the gate they reported as coverage while never executing — a
      // placeholder assertion is at least visibly a placeholder. Excluded here
      // so the gate stops implying it ran them, and included in the live config
      // so something does.
      "tests/integration/**",
    ],
  },
});
