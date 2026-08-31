import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Live-environment checks: assertions about PRODUCTION rather than about this
 * tree. They need real credentials, so they are excluded from the default suite
 * (see vitest.config.ts) and run from rls-check.yml on a schedule instead.
 *
 * A separate config rather than a CLI flag, because vitest's `--exclude` APPENDS
 * to the config's exclude list rather than replacing it — naming the file on the
 * command line does not override it, so a workflow written that way silently
 * runs nothing and reports success.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "src/checks/rls.check.test.ts",
      "src/checks/function-privileges.check.test.ts",
      "src/checks/object-inventory.check.test.ts",
      // Matches nothing until an item lands one, which is fine: the guard in
      // tests/regression/live-checks.test.ts requires the config as a WHOLE to
      // select at least one file, not every pattern to match. A pattern that
      // selects nothing while another still runs is not the rot worth failing
      // on; a config that selects nothing at all is.
      "tests/integration/**/*.test.ts",
    ],
  },
});
