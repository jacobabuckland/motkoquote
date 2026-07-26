#!/usr/bin/env node
// Release-QA invariant checker — BOOTSTRAP STUB (release-qa skill, layer 2).
//
// Theory: the dominant bug class in agent-parallel development is "two code
// paths rendering one truth" (duplicate formatters / state writers / vocab).
// This script is the mechanical guard that makes that drift visible. It is a
// STUB: hard invariants (single money formatter, single settlement writer) FAIL
// the build; softer heuristics only WARN for now. Tighten WARN -> FAIL in a
// Workflow D hardening sweep once the flagged spots are triaged.
//
// Run: `npm run check`. Exit 1 on any hard-invariant violation, else 0.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};

const files = walk(SRC);
const isTest = (f) => /\.test\.tsx?$|\.spec\.tsx?$/.test(f);
const src = files.filter((f) => !isTest(f));
const rel = (f) => f.replace(process.cwd() + "/", "");

let hardFailures = 0;
let warnings = 0;
const fail = (msg) => (hardFailures++, console.error(`  ✖ ${msg}`));
const warn = (msg) => (warnings++, console.warn(`  ⚠ ${msg}`));

// --- HARD INVARIANT 1: exactly one money formatter, in src/lib/format.ts ------
// All GBP rendering must go through formatGBP so amounts never diverge.
console.log("[1] Single money formatter (formatGBP @ src/lib/format.ts)");
const formatDefiners = src.filter((f) =>
  /export\s+(const|function)\s+formatGBP\b/.test(readFileSync(f, "utf8")),
);
if (formatDefiners.length === 0) fail("formatGBP is not defined anywhere");
else if (formatDefiners.length > 1)
  fail(`formatGBP defined in >1 file: ${formatDefiners.map(rel).join(", ")}`);
else if (!formatDefiners[0].endsWith("src/lib/format.ts"))
  fail(`formatGBP must live in src/lib/format.ts, found in ${rel(formatDefiners[0])}`);
else console.log("  ✓ one definition, in src/lib/format.ts");

// --- HARD INVARIANT 2: exactly one settlement writer -------------------------
// Only settlePaidJob may flip an invoice to paid (fee/credit/referral effects
// hang off that single path). A second writer would double-settle.
console.log("[2] Single settlement writer (invoice -> paid only in settle-paid-job.ts)");
const paidWriters = src.filter((f) => /status:\s*["']paid["']/.test(readFileSync(f, "utf8")));
const strayPaidWriters = paidWriters.filter((f) => !f.endsWith("src/lib/settle-paid-job.ts"));
if (strayPaidWriters.length > 0)
  fail(`invoice->paid written outside settle-paid-job.ts: ${strayPaidWriters.map(rel).join(", ")}`);
else console.log("  ✓ settlePaidJob is the only invoice->paid writer");

// --- SOFT HEURISTIC: ad-hoc currency formatting that bypasses formatGBP -------
// WARN-only for now; triage each and either route through formatGBP or annotate.
console.log("[3] Ad-hoc currency formatting (advisory — triage in Workflow D)");
const currencyBypass = /£\s*\$\{|\$\{[^}]*\.toFixed\(2\)|toLocaleString\([^)]*GBP/;
const bypassHits = src.filter(
  (f) => !f.endsWith("src/lib/format.ts") && currencyBypass.test(readFileSync(f, "utf8")),
);
if (bypassHits.length) bypassHits.forEach((f) => warn(`possible currency bypass: ${rel(f)}`));
else console.log("  ✓ none found");

console.log(
  `\ncheck-invariants: ${hardFailures} hard failure(s), ${warnings} advisory warning(s).`,
);
process.exit(hardFailures > 0 ? 1 : 0);
