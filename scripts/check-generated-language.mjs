#!/usr/bin/env node

/**
 * CI lint: checks that drafted quote output does not contain "as agreed"
 * phrases unless they come from a captured field.
 *
 * This is a thin wrapper that delegates to the TypeScript implementation.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tsScript = join(__dirname, "check-generated-language.ts");

const child = spawn("npx", ["tsx", tsScript], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
