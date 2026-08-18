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
    include: ["src/checks/rls.check.test.ts"],
  },
});
