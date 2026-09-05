import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Checker rule: a module carrying the "use server" directive may export ONLY
// async functions. Next.js enforces this when the module is first resolved, and
// the failure mode is the worst kind — it throws at RUNTIME, in production, and
// takes the module's ENTIRE export surface down with it:
//
//   A "use server" file can only export async functions, found object
//
// Every server action in that file stops resolving, so the page that imports
// them 500s. On 5 Sep 2026 a single `export const sendQuoteSchema = z.object(…)`
// added to src/app/jobs/actions.ts did exactly that to POST /jobs/[id].
//
// NOTHING in the pipeline caught it. Not `tsc` — the code is perfectly typed.
// Not ESLint. Not `next build`, which exited 0. Not 4,314 tests. The first
// signal was Sentry, from production. src/lib/quote-send-guards.ts exists
// specifically to hold values that would otherwise live in that file, and its
// header documents this hazard — the rule was written down and broken anyway,
// which is the argument for a check rather than a note.
//
// Parsed with the TypeScript AST rather than matched with a regex: the whole
// point is to tell `export const x = async () => {}` (legal) from
// `export const x = someObject` (fatal), and that is a question about the
// initializer's shape, which no regex answers reliably.
//
// If this fails, do NOT relax it. Move the value into a plain module and import
// it from there — that is what quote-send-guards.ts is for.

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
};

/** Files whose first statement is the "use server" directive. */
const serverActionModules = (): { path: string; source: ts.SourceFile }[] =>
  walk(join(process.cwd(), "src"))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))
    .filter(({ text }) => /^\s*["']use server["']/.test(text))
    .map(({ path, text }) => ({
      path: relative(process.cwd(), path),
      source: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
    }));

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

const isExported = (node: ts.Node) => hasModifier(node, ts.SyntaxKind.ExportKeyword);

/** An async function expression, arrow or otherwise. */
const isAsyncFunctionValue = (init: ts.Expression | undefined): boolean =>
  !!init &&
  (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
  hasModifier(init, ts.SyntaxKind.AsyncKeyword);

/** Every runtime export in the file that is NOT an async function. */
const offendingExports = (source: ts.SourceFile): string[] => {
  const bad: string[] = [];

  for (const statement of source.statements) {
    if (!isExported(statement)) continue;

    // Types are erased before the module exists at runtime, so they are fine.
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      continue;
    }

    if (ts.isFunctionDeclaration(statement)) {
      if (!hasModifier(statement, ts.SyntaxKind.AsyncKeyword)) {
        bad.push(`${statement.name?.text ?? "<anonymous>"} (function, not async)`);
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      // `export type` written as a const is impossible, so every declaration
      // here is a runtime value and must be an async function.
      for (const decl of statement.declarationList.declarations) {
        if (!isAsyncFunctionValue(decl.initializer)) {
          const name = ts.isIdentifier(decl.name) ? decl.name.text : "<destructured>";
          bad.push(`${name} (const, not an async function)`);
        }
      }
      continue;
    }

    // Anything else exported at runtime — a class, an enum — is fatal too.
    bad.push(`${ts.SyntaxKind[statement.kind]} export`);
  }

  return bad;
};

describe('a "use server" module exports only async functions', () => {
  const modules = serverActionModules();

  it("finds the server-action modules at all", () => {
    // Without this, a broken walk or a changed directive spelling would make
    // every assertion below vacuously pass — a check over an empty set.
    expect(modules.length).toBeGreaterThan(15);
  });

  it.each(modules.map((m) => m.path))("%s", (path) => {
    const mod = modules.find((m) => m.path === path);
    expect(
      offendingExports(mod!.source),
      `${path} carries "use server", so every export must be an async function. ` +
        "A non-function export throws when the module is first resolved and takes " +
        "the whole module's exports down with it. Move the value to a plain " +
        "module — see src/lib/quote-send-guards.ts.",
    ).toEqual([]);
  });
});
