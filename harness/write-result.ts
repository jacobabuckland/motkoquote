#!/usr/bin/env tsx

/**
 * In-repo GPT voice-harness writer (see GPT_HARNESS.md).
 *
 * Validates a run against harness/harness-result.schema.json and updates the
 * shared repo files (results/, NEXT_FIX.md, BACKLOG.md, RETEST_PROMPT.md,
 * LESSONS.md). See harness/WIRING.md.
 *
 *   npx tsx harness/write-result.ts path/to/result.json
 *   cat result.json | npx tsx harness/write-result.ts
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_VERSION = "1.0.0";

export type CaseStatus = "passed" | "failed" | "blocked";
export type Severity = "critical" | "high" | "medium" | "low";
export type NextFixStatus = "idle" | "open" | "honing";

export interface HarnessTurn {
  role: "tradesperson" | "motko" | "system";
  text: string;
  atMs?: number;
}

export interface HarnessCase {
  id: string;
  title: string;
  trade: string;
  persona: string;
  tags?: string[];
  status: CaseStatus;
  severity: Severity;
  expected: {
    outcome: string;
    mustInclude?: string[];
    mustNotInclude?: string[];
    quoteChecks?: {
      labourDays?: number | null;
      people?: number | null;
      currency?: "GBP";
      totalMin?: number | null;
      totalMax?: number | null;
    };
  };
  actual: {
    outcome: string;
    quoteSummary?: string | null;
    totalGbp?: number | null;
    errors?: string[];
    screenshots?: string[];
    audio?: string[];
  };
  turns: HarnessTurn[];
  diagnosis?: string | null;
}

export interface HarnessResult {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  startedAt: string;
  finishedAt: string;
  environment: {
    app: string;
    voiceModel: string;
    harness: string;
    locale?: string;
    notes?: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    topFailureCaseId?: string | null;
  };
  cases: HarnessCase[];
}

export interface NextFixState {
  runId: string;
  caseId: string;
  severity: string;
  trade: string;
  resultFile: string;
  status: NextFixStatus;
  attempts: number;
  fixPr: string;
}

export type WriterAction =
  | "recorded-pass"
  | "locked"
  | "honing-failed"
  | "honing-passed"
  | "deferred";

export interface WriteOutcome {
  action: WriterAction;
  runId: string;
  resultPath: string;
  archivedPath?: string;
  lockedCaseId?: string;
  backlogCaseIds: string[];
  messages: string[];
}

export interface WriteOptions {
  harnessRoot: string;
}

interface JsonSchema {
  type?: string | string[];
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  const?: unknown;
  enum?: unknown[];
  minLength?: number;
  minItems?: number;
  minimum?: number;
  format?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const SAFE_RUN_ID = /^[A-Za-z0-9._@+-]+$/;
const RESERVED_RUN_IDS = new Set(["example-result"]);

const IDLE_NEXT_FIX = `# NEXT_FIX

> Claude Code: while \`status\` is \`open\` or \`honing\`, fix **only** this case. After merge, do **not** clear this file — rewrite \`harness/RETEST_PROMPT.md\` for GPT and set \`status: honing\`. Clear to idle only when RETEST reports \`status: clean\`.

\`\`\`yaml
runId: ""
caseId: ""
severity: ""
trade: ""
resultFile: ""
status: idle
attempts: 0
fixPr: ""
\`\`\`

## What the tradesperson said

## What Motko did

## What should have happened

## Evidence

## Suspected cause (from harness — verify)

## Acceptance checks

## Out of scope
`;

export function defaultHarnessRoot(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export function loadSchema(harnessRoot: string): JsonSchema {
  const path = join(harnessRoot, "harness-result.schema.json");
  return JSON.parse(readFileSync(path, "utf8")) as JsonSchema;
}

export function validateHarnessResult(
  raw: unknown,
  schema: JsonSchema,
): { ok: true; value: HarnessResult } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  validateAgainstSchema(raw, schema, "$", schema.$defs ?? {}, errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: raw as HarnessResult };
}

function validateAgainstSchema(
  instance: unknown,
  schema: JsonSchema,
  path: string,
  defs: Record<string, JsonSchema>,
  errors: string[],
): void {
  if (schema.$ref) {
    const name = schema.$ref.replace("#/$defs/", "");
    const resolved = defs[name];
    if (!resolved) {
      errors.push(`${path}: unknown $ref ${schema.$ref}`);
      return;
    }
    validateAgainstSchema(instance, resolved, path, defs, errors);
    return;
  }

  const types = schema.type === undefined
    ? []
    : Array.isArray(schema.type)
      ? schema.type
      : [schema.type];

  if (instance === null) {
    if (types.length > 0 && types.indexOf("null") === -1) {
      errors.push(`${path}: expected ${types.join("|")}, got null`);
    }
    if (schema.const !== undefined && schema.const !== null) {
      errors.push(`${path}: expected ${JSON.stringify(schema.const)}, got null`);
    }
    return;
  }

  if (types.length > 0 && !matchesType(instance, types)) {
    errors.push(`${path}: expected ${types.join("|")}, got ${describeType(instance)}`);
    return;
  }

  if (schema.const !== undefined && !sameValue(instance, schema.const)) {
    errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && schema.enum.every((allowed) => !sameValue(instance, allowed))) {
    errors.push(`${path}: expected one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  }

  if (typeof instance === "string") {
    if (schema.minLength !== undefined && instance.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.format === "date-time" && !isDateTime(instance)) {
      errors.push(`${path}: not a date-time (expected ISO-8601)`);
    }
  }

  if (typeof instance === "number" && schema.minimum !== undefined && instance < schema.minimum) {
    errors.push(`${path}: below minimum ${schema.minimum}`);
  }

  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.items) {
      instance.forEach((item, i) => {
        validateAgainstSchema(item, schema.items as JsonSchema, `${path}[${i}]`, defs, errors);
      });
    }
  }

  if (isPlainObject(instance) && schema.properties) {
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(instance, key)) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
          errors.push(`${path}: unexpected property "${key}"`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(instance, key)) {
        validateAgainstSchema(instance[key], childSchema, `${path}.${key}`, defs, errors);
      }
    }
  }
}

function matchesType(instance: unknown, types: string[]): boolean {
  return types.some((type) => {
    if (type === "null") return instance === null;
    if (type === "array") return Array.isArray(instance);
    if (type === "object") return isPlainObject(instance);
    if (type === "integer") {
      return typeof instance === "number" && Number.isInteger(instance);
    }
    if (type === "number") {
      return typeof instance === "number" && Number.isFinite(instance);
    }
    if (type === "string") return typeof instance === "string";
    if (type === "boolean") return typeof instance === "boolean";
    return false;
  });
}

function describeType(instance: unknown): string {
  if (instance === null) return "null";
  if (Array.isArray(instance)) return "array";
  return typeof instance;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isDateTime(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function parseNextFix(markdown: string): NextFixState {
  const yaml = extractYamlFence(markdown);
  const statusRaw = yamlField(yaml, "status") || "idle";
  const status: NextFixStatus =
    statusRaw === "open" || statusRaw === "honing" || statusRaw === "idle"
      ? statusRaw
      : "idle";
  const attempts = Number(yamlField(yaml, "attempts") || "0");
  return {
    runId: yamlField(yaml, "runId"),
    caseId: yamlField(yaml, "caseId"),
    severity: yamlField(yaml, "severity"),
    trade: yamlField(yaml, "trade"),
    resultFile: yamlField(yaml, "resultFile"),
    status,
    attempts: Number.isFinite(attempts) ? attempts : 0,
    fixPr: yamlField(yaml, "fixPr"),
  };
}

export function failingCases(result: HarnessResult): HarnessCase[] {
  return result.cases.filter((c) => c.status === "failed" || c.status === "blocked");
}

export function pickTopFailure(result: HarnessResult): HarnessCase | null {
  const failing = failingCases(result);
  if (failing.length === 0) return null;
  const hinted = result.summary.topFailureCaseId;
  if (hinted) {
    const match = failing.find((c) => c.id === hinted);
    if (match) return match;
  }
  return [...failing].sort((a, b) => {
    const rank = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (rank !== 0) return rank;
    return result.cases.indexOf(a) - result.cases.indexOf(b);
  })[0];
}

function safeRunId(runId: string): string {
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error(
      `runId ${JSON.stringify(runId)} is not a safe filename (use letters, numbers, . _ - @ +)`,
    );
  }
  if (RESERVED_RUN_IDS.has(runId)) {
    throw new Error(`runId ${JSON.stringify(runId)} is reserved for the committed example`);
  }
  return runId;
}

function resultRelPath(runId: string): string {
  return `harness/results/${runId}.json`;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function singleCaseResult(result: HarnessResult, theCase: HarnessCase): HarnessResult {
  const passed = theCase.status === "passed" ? 1 : 0;
  const failed = theCase.status === "failed" ? 1 : 0;
  const blocked = theCase.status === "blocked" ? 1 : 0;
  return {
    ...result,
    summary: {
      total: 1,
      passed,
      failed,
      blocked,
      topFailureCaseId: failed + blocked > 0 ? theCase.id : null,
    },
    cases: [theCase],
  };
}

export function writeHarnessResult(raw: unknown, options: WriteOptions): WriteOutcome {
  const schema = loadSchema(options.harnessRoot);
  const validated = validateHarnessResult(raw, schema);
  if (!validated.ok) {
    throw new WriterValidationError(validated.errors);
  }
  const incoming = validated.value;
  const runId = safeRunId(incoming.runId);
  const nextFixPath = join(options.harnessRoot, "NEXT_FIX.md");
  const retestPath = join(options.harnessRoot, "RETEST_PROMPT.md");
  const backlogPath = join(options.harnessRoot, "BACKLOG.md");
  const lessonsPath = join(options.harnessRoot, "LESSONS.md");
  const resultsDir = join(options.harnessRoot, "results");
  const archiveDir = join(resultsDir, "archive");

  if (!existsSync(nextFixPath)) {
    throw new Error(`missing ${nextFixPath}`);
  }

  const nextFixMd = readFileSync(nextFixPath, "utf8");
  const nextFix = parseNextFix(nextFixMd);
  const messages: string[] = [];
  const backlogCaseIds: string[] = [];

  const locked =
    (nextFix.status === "open" || nextFix.status === "honing") && nextFix.caseId
      ? nextFix.caseId
      : null;

  let toWrite: HarnessResult = incoming;
  if (nextFix.status === "honing" && locked) {
    const theCase = incoming.cases.find((c) => c.id === locked);
    if (!theCase) {
      writeJson(join(resultsDir, `${runId}.json`), incoming);
      const extras = failingCases(incoming);
      if (existsSync(backlogPath) && extras.length > 0) {
        appendBacklog(
          backlogPath,
          extras,
          incoming,
          dateStamp(incoming.finishedAt),
        ).forEach((id) => backlogCaseIds.push(id));
      }
      messages.push(
        `NEXT_FIX is honing ${locked}; this run has no such case. Wrote the JSON and left the lock unchanged.`,
      );
      return {
        action: "deferred",
        runId,
        resultPath: resultRelPath(runId),
        backlogCaseIds,
        messages,
      };
    }
    toWrite = singleCaseResult(incoming, theCase);
    const others = failingCases(incoming).filter((c) => c.id !== locked);
    if (existsSync(backlogPath) && others.length > 0) {
      appendBacklog(
        backlogPath,
        others,
        incoming,
        dateStamp(incoming.finishedAt),
      ).forEach((id) => backlogCaseIds.push(id));
      messages.push(
        `Honing ${locked}: ignored ${others.length} other failure(s) (noted in BACKLOG.md).`,
      );
    }
  }

  const dest = join(resultsDir, `${runId}.json`);
  writeJson(dest, toWrite);
  messages.push(`Wrote ${resultRelPath(runId)}`);

  if (nextFix.status === "honing" && locked) {
    const theCase = toWrite.cases[0];
    if (theCase.status === "passed") {
      const whatBroke =
        sectionText(nextFixMd, "What Motko did") || theCase.expected.outcome;
      const archivedPath = archiveResult(dest, archiveDir, runId);
      writeFileSync(nextFixPath, IDLE_NEXT_FIX, "utf8");
      if (existsSync(retestPath)) {
        updateRetestYaml(retestPath, {
          runId,
          status: "clean",
        });
      }
      if (existsSync(lessonsPath)) {
        appendLesson(
          lessonsPath,
          theCase,
          nextFix,
          incoming,
          dateStamp(incoming.finishedAt),
          whatBroke,
        );
      }
      messages.push(
        `Retest passed. Archived to harness/results/archive/${runId}.json, NEXT_FIX idle, RETEST clean.`,
      );
      return {
        action: "honing-passed",
        runId,
        resultPath: `harness/results/archive/${runId}.json`,
        archivedPath,
        lockedCaseId: locked,
        backlogCaseIds,
        messages,
      };
    }

    const attempts = nextFix.attempts + 1;
    writeFileSync(
      nextFixPath,
      updateLockedNextFix(nextFixMd, {
        ...nextFix,
        runId,
        resultFile: resultRelPath(runId),
        status: "honing",
        attempts,
      }, theCase, incoming, { refreshEvidenceOnly: true }),
      "utf8",
    );
    if (existsSync(retestPath)) {
      updateRetestYaml(retestPath, {
        runId,
        status: "honing",
        attempts,
      });
    }
    messages.push(
      `Retest failed for ${locked}. Kept the lock, attempts=${attempts}, refreshed Evidence.`,
    );
    return {
      action: "honing-failed",
      runId,
      resultPath: resultRelPath(runId),
      lockedCaseId: locked,
      backlogCaseIds,
      messages,
    };
  }

  const top = pickTopFailure(toWrite);

  if (locked) {
    const others = failingCases(toWrite).filter((c) => c.id !== locked);
    if (existsSync(backlogPath) && others.length > 0) {
      appendBacklog(
        backlogPath,
        others,
        incoming,
        dateStamp(incoming.finishedAt),
      ).forEach((id) => backlogCaseIds.push(id));
    }
    if (top && top.id !== locked) {
      messages.push(
        `NEXT_FIX is ${nextFix.status} on ${locked}; did not overwrite with ${top.id}.`,
      );
      return {
        action: "deferred",
        runId,
        resultPath: resultRelPath(runId),
        lockedCaseId: locked,
        backlogCaseIds,
        messages,
      };
    }
    if (top && top.id === locked && nextFix.status === "open") {
      writeFileSync(
        nextFixPath,
        updateLockedNextFix(nextFixMd, {
          ...nextFix,
          runId,
          resultFile: resultRelPath(runId),
        }, top, incoming, { refreshEvidenceOnly: true }),
        "utf8",
      );
      messages.push(`Updated evidence for the already-open case ${locked}.`);
    } else {
      messages.push(`NEXT_FIX already ${nextFix.status} on ${locked}; lock unchanged.`);
    }
    return {
      action: "deferred",
      runId,
      resultPath: resultRelPath(runId),
      lockedCaseId: locked,
      backlogCaseIds,
      messages,
    };
  }

  if (!top) {
    messages.push("All cases passed. NEXT_FIX left idle.");
    return {
      action: "recorded-pass",
      runId,
      resultPath: resultRelPath(runId),
      backlogCaseIds,
      messages,
    };
  }

  const others = failingCases(toWrite).filter((c) => c.id !== top.id);
  if (existsSync(backlogPath) && others.length > 0) {
    appendBacklog(
      backlogPath,
      others,
      incoming,
      dateStamp(incoming.finishedAt),
    ).forEach((id) => backlogCaseIds.push(id));
    messages.push(`Backlogged ${others.length} other failure(s).`);
  }

  writeFileSync(
    nextFixPath,
    updateLockedNextFix(nextFixMd, {
      runId,
      caseId: top.id,
      severity: top.severity,
      trade: top.trade,
      resultFile: resultRelPath(runId),
      status: "open",
      attempts: 0,
      fixPr: "",
    }, top, incoming, { refreshEvidenceOnly: false }),
    "utf8",
  );
  messages.push(`Locked NEXT_FIX on ${top.id} (status: open).`);
  return {
    action: "locked",
    runId,
    resultPath: resultRelPath(runId),
    lockedCaseId: top.id,
    backlogCaseIds,
    messages,
  };
}

function archiveResult(activePath: string, archiveDir: string, runId: string): string {
  mkdirSync(archiveDir, { recursive: true });
  let dest = join(archiveDir, `${runId}.json`);
  if (existsSync(dest)) {
    dest = join(archiveDir, `${runId}-${Date.now()}.json`);
  }
  if (existsSync(activePath)) {
    renameSync(activePath, dest);
  }
  return dest;
}

function dateStamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return match ? match[1] : new Date().toISOString().slice(0, 10);
}

function extractYamlFence(markdown: string): string {
  const match = markdown.match(/```yaml\n([\s\S]*?)\n```/);
  return match ? match[1] : "";
}

function yamlField(block: string, key: string): string {
  const match = block.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!match) return "";
  let value = match[1];
  const hash = value.indexOf(" #");
  if (hash !== -1) value = value.slice(0, hash);
  value = value.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function yamlScalar(value: string | number): string {
  if (typeof value === "number") return String(value);
  if (value === "") return '""';
  if (/^[A-Za-z0-9._/@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function replaceYamlFence(markdown: string, fields: NextFixState): string {
  const yaml = [
    `runId: ${yamlScalar(fields.runId)}`,
    `caseId: ${yamlScalar(fields.caseId)}`,
    `severity: ${yamlScalar(fields.severity)}`,
    `trade: ${yamlScalar(fields.trade)}`,
    `resultFile: ${yamlScalar(fields.resultFile)}`,
    `status: ${fields.status}`,
    `attempts: ${fields.attempts}`,
    `fixPr: ${yamlScalar(fields.fixPr)}`,
  ].join("\n");
  return markdown.replace(/```yaml\n[\s\S]*?\n```/, `\`\`\`yaml\n${yaml}\n\`\`\``);
}

function replaceSection(markdown: string, heading: string, body: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(## ${escaped}\\n)([\\s\\S]*?)(?=\\n## |$)`);
  if (!re.test(markdown)) return markdown;
  return markdown.replace(re, `$1\n${body.trim()}\n`);
}

function traderSaid(theCase: HarnessCase): string {
  const lines = theCase.turns
    .filter((t) => t.role === "tradesperson")
    .map((t) => t.text.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines.join("\n\n") : "_(no tradesperson turn in result)_";
}

function evidenceBlock(theCase: HarnessCase, result: HarnessResult): string {
  const turns = theCase.turns
    .map((t) => {
      const when = typeof t.atMs === "number" ? ` +${t.atMs}ms` : "";
      return `- [${t.role}${when}] ${t.text}`;
    })
    .join("\n");
  const errors = (theCase.actual.errors ?? []).filter(Boolean);
  const errorLine = errors.length > 0 ? `\n\nErrors:\n${errors.map((e) => `- ${e}`).join("\n")}` : "";
  const quote = theCase.actual.quoteSummary
    ? `\n\nQuote summary: ${theCase.actual.quoteSummary}`
    : "";
  return [
    `Run \`${result.runId}\` (${result.finishedAt}).`,
    "",
    "Transcript:",
    turns || "- _(no turns)_",
    "",
    `Actual: ${theCase.actual.outcome}${quote}${errorLine}`,
  ].join("\n");
}

function acceptanceBlock(theCase: HarnessCase): string {
  const lines: string[] = [`- ${theCase.expected.outcome}`];
  for (const item of theCase.expected.mustInclude ?? []) {
    lines.push(`- must include: ${item}`);
  }
  for (const item of theCase.expected.mustNotInclude ?? []) {
    lines.push(`- must not include: ${item}`);
  }
  const qc = theCase.expected.quoteChecks;
  if (qc) {
    const bits = [
      qc.people != null ? `people=${qc.people}` : null,
      qc.labourDays != null ? `labourDays=${qc.labourDays}` : null,
      qc.totalMin != null ? `totalMin=${qc.totalMin}` : null,
      qc.totalMax != null ? `totalMax=${qc.totalMax}` : null,
    ].filter((bit): bit is string => bit !== null);
    if (bits.length > 0) lines.push(`- quote checks: ${bits.join(", ")}`);
  }
  return lines.join("\n");
}

function updateLockedNextFix(
  markdown: string,
  fields: NextFixState,
  theCase: HarnessCase,
  result: HarnessResult,
  opts: { refreshEvidenceOnly: boolean },
): string {
  let next = replaceYamlFence(markdown, fields);
  next = replaceSection(next, "Evidence", evidenceBlock(theCase, result));
  next = replaceSection(
    next,
    "What Motko did",
    theCase.actual.outcome,
  );
  if (!opts.refreshEvidenceOnly) {
    next = replaceSection(next, "What the tradesperson said", traderSaid(theCase));
    next = replaceSection(next, "What should have happened", theCase.expected.outcome);
    next = replaceSection(
      next,
      "Suspected cause (from harness — verify)",
      theCase.diagnosis?.trim() || "_(none supplied)_",
    );
    next = replaceSection(next, "Acceptance checks", acceptanceBlock(theCase));
  }
  return next.endsWith("\n") ? next : `${next}\n`;
}

function updateRetestYaml(
  path: string,
  patch: { runId?: string; status?: string; attempts?: number },
): void {
  const md = readFileSync(path, "utf8");
  const fence = extractYamlFence(md);
  if (!fence) return;
  let updated = fence;
  if (patch.runId !== undefined) {
    updated = setYamlLine(updated, "runId", yamlScalar(patch.runId));
  }
  if (patch.status !== undefined) {
    updated = setYamlLine(updated, "status", patch.status);
  }
  if (patch.attempts !== undefined) {
    updated = setYamlLine(updated, "attempts", String(patch.attempts));
  }
  writeFileSync(path, md.replace(fence, updated), "utf8");
}

function setYamlLine(block: string, key: string, value: string): string {
  const re = new RegExp(`^${key}:\\s*([^#\\n]*)(.*)$`, "m");
  if (!re.test(block)) {
    return `${block}\n${key}: ${value}`;
  }
  return block.replace(re, (_all, _old: string, rest: string) => {
    const comment = rest.startsWith("#") ? ` ${rest}` : rest;
    return `${key}: ${value}${comment}`;
  });
}

function appendBacklog(
  path: string,
  cases: HarnessCase[],
  result: HarnessResult,
  day: string,
): string[] {
  const existing = readFileSync(path, "utf8");
  const added: string[] = [];
  const lines: string[] = [];
  for (const theCase of cases) {
    if (existing.includes(` · ${theCase.id} ·`)) continue;
    const oneLine = theCase.actual.outcome.replace(/\s+/g, " ").trim();
    lines.push(
      `- ${day} · ${theCase.id} · ${theCase.severity} · ${oneLine} · ${resultRelPath(result.runId)}`,
    );
    added.push(theCase.id);
  }
  if (lines.length === 0) return added;
  const suffix = existing.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${existing}${suffix}${lines.join("\n")}\n`, "utf8");
  return added;
}

function appendLesson(
  path: string,
  theCase: HarnessCase,
  nextFix: NextFixState,
  result: HarnessResult,
  day: string,
  whatBroke: string,
): void {
  const existing = readFileSync(path, "utf8");
  const broke = whatBroke || theCase.expected.outcome;
  const watch = theCase.expected.mustInclude?.join("; ") || theCase.expected.outcome;
  const fixed = nextFix.fixPr
    ? `retest passed after ${nextFix.fixPr} (run ${result.runId})`
    : `retest passed (run ${result.runId})`;
  const bullet = `- ${day} · ${theCase.id} · ${oneLine(broke)} · ${oneLine(fixed)} · ${oneLine(watch)}`;
  if (existing.includes(` · ${theCase.id} ·`) && existing.includes(result.runId)) {
    return;
  }
  const suffix = existing.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${existing}${suffix}${bullet}\n`, "utf8");
}

function sectionText(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match ? match[1].trim() : "";
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").replace(/^[-*]\s*/, "").trim() || "_(none)_";
}

export class WriterValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(`Invalid harness result:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    this.name = "WriterValidationError";
    this.errors = errors;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printUsage(): void {
  process.stderr.write(`Usage:
  npx tsx harness/write-result.ts <result.json>
  npx tsx harness/write-result.ts - < result.json
  cat result.json | npx tsx harness/write-result.ts

Options:
  --harness-root <dir>   Defaults to the harness/ directory next to this script
  --help                 Show this message

See harness/WIRING.md.
`);
}

function parseArgs(argv: string[]): {
  help: boolean;
  harnessRoot: string;
  inputPath: string | null;
} {
  let harnessRoot = defaultHarnessRoot();
  let inputPath: string | null = null;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--harness-root") {
      const value = argv[i + 1];
      if (!value) throw new Error("--harness-root needs a directory");
      harnessRoot = resolve(value);
      i += 1;
    } else if (arg === "-" || arg === "--stdin") {
      inputPath = "-";
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      inputPath = arg;
    }
  }
  return { help, harnessRoot, inputPath };
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  let parsed: { help: boolean; harnessRoot: string; inputPath: string | null };
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    printUsage();
    return 1;
  }
  if (parsed.help) {
    printUsage();
    return 0;
  }

  let source = parsed.inputPath;
  if (!source) {
    if (process.stdin.isTTY) {
      printUsage();
      return 1;
    }
    source = "-";
  }

  let text: string;
  try {
    text = source === "-"
      ? await readStdin()
      : readFileSync(resolve(source), "utf8");
  } catch (error) {
    process.stderr.write(`Could not read ${source}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    process.stderr.write(`Result is not JSON: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  try {
    const outcome = writeHarnessResult(raw, { harnessRoot: parsed.harnessRoot });
    process.stdout.write(`${outcome.action}\t${outcome.runId}\t${outcome.resultPath}\n`);
    for (const message of outcome.messages) {
      process.stdout.write(`${message}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof WriterValidationError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  : false;

if (invokedDirectly) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
