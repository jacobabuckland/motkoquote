/**
 * Every column a select names must be created by a migration in this tree.
 *
 * On 26 Aug 2026 two selects named `quotes.sent_total` while the migration
 * adding it was not applied to production. Both queries were rejected, both
 * call sites dropped the error, and the job page rendered "Your quote is on its
 * way" beside a "Quote ready" badge while every customer quote link 404'd.
 *
 * `scripts/ci/schema-probe.ts` is the check for that exact failure and it is
 * the right one — it asks PRODUCTION whether the column is there. It has never
 * run: both its secrets are unset, so it takes its skip path on every PR.
 *
 * THIS CHECK IS NOT THAT CHECK, AND MUST NOT BE READ AS IT.
 *
 *   What it proves:     the tree is internally consistent. No select names a
 *                       column no migration anywhere in supabase/migrations/
 *                       creates.
 *   What it cannot see: production. A migration can sit in this tree, green
 *                       here, and never have been applied — which is precisely
 *                       what happened. Green here says nothing about prod.
 *
 * It runs on every PR with no credentials, which is why it is worth having: it
 * catches a typo'd column, a select written against a migration that was
 * renumbered or reverted, and code merged ahead of a migration nobody wrote.
 * The remaining gap — tree correct, production behind — is what the probe and
 * the migration/code refusal in ci.yml are for.
 */

const CONSTRAINT_KEYWORDS = new Set([
  "primary",
  "foreign",
  "unique",
  "check",
  "constraint",
  "exclude",
  "like",
]);

/** Split on commas that are not inside parentheses. */
export const splitTopLevel = (input: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
};

/** Strip SQL comments and normalise whitespace, so patterns can be line-blind. */
const stripSql = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

/** Take the body of the parenthesised group that starts at `open`. */
const balancedBody = (text: string, open: number): string | null => {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
};

const bareTable = (name: string): string =>
  name.replace(/"/g, "").replace(/^public\./i, "");

/**
 * The set of columns each table has, according to the migrations in the tree.
 *
 * Only `create table` and `alter table … add column` appear in this repo's
 * migrations today — no renames, no drops, no views. Rather than silently
 * ignoring a shape it does not model, this reports unknown DDL so a migration
 * that renames or drops a column cannot pass unnoticed and leave the table's
 * column set wrong.
 */
export const schemaFromMigrations = (
  files: Array<{ path: string; sql: string }>,
): { tables: Map<string, Set<string>>; unmodelled: string[] } => {
  const tables = new Map<string, Set<string>>();
  const unmodelled: string[] = [];

  const columnsOf = (table: string): Set<string> => {
    const key = bareTable(table);
    let set = tables.get(key);
    if (!set) {
      set = new Set<string>();
      tables.set(key, set);
    }
    return set;
  };

  for (const { path, sql: raw } of files) {
    const sql = stripSql(raw);

    const createTable = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w".]+)\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = createTable.exec(sql)) !== null) {
      const body = balancedBody(sql, createTable.lastIndex - 1);
      if (body === null) continue;
      const set = columnsOf(match[1]);
      for (const def of splitTopLevel(body)) {
        const first = def.split(/\s+/)[0].replace(/"/g, "").toLowerCase();
        if (!first || CONSTRAINT_KEYWORDS.has(first)) continue;
        set.add(first);
      }
    }

    // One `alter table` can add several columns:
    //
    //   alter table contracts
    //     add column rendered_body text,
    //     add column signer_name text;
    //
    // so the table is matched once and every `add column` up to the statement's
    // semicolon belongs to it. Requiring `alter table X add column` adjacent
    // saw only the first of each group, and missed six real columns in this
    // repo's own migrations.
    const alterTable = /alter\s+table\s+(?:if\s+exists\s+)?([\w".]+)/gi;
    while ((match = alterTable.exec(sql)) !== null) {
      const end = sql.indexOf(";", alterTable.lastIndex);
      const statement = sql.slice(alterTable.lastIndex, end === -1 ? undefined : end);
      const set = columnsOf(match[1]);
      const addColumn = /add\s+column(?:\s+if\s+not\s+exists)?\s+([\w"]+)/gi;
      let add: RegExpExecArray | null;
      while ((add = addColumn.exec(statement)) !== null) {
        set.add(add[1].replace(/"/g, "").toLowerCase());
      }
    }

    // A rename or a drop changes the column set and this parser does not model
    // either. Say so rather than quietly producing a wrong answer.
    for (const shape of [/rename\s+column\s/i, /drop\s+column\s/i]) {
      if (shape.test(sql)) unmodelled.push(path);
    }
  }

  return { tables, unmodelled: [...new Set(unmodelled)] };
};

export type ColumnReference = {
  table: string;
  column: string;
  /** Line the enclosing `.select(` opens on. */
  line: number;
  /**
   * Line the select literal closes on — the same as `line` for a single-line
   * select. Callers that need to know whether a diff wrote a reference must
   * consider the whole span: a select string spread over five lines reports
   * every column it names at its opening line, so asking only about `line`
   * would miss a column added on line four of it.
   */
  endLine: number;
};

/**
 * Parse a PostgREST select string into the columns it names, per table.
 *
 * The forms that appear in this codebase:
 *
 *   "id, total"                        plain columns
 *   "*"                                everything — nothing to check
 *   "customer:customers(name)"         an embedded resource, aliased
 *   "contracts(id, status)"            an embedded resource, unaliased
 *   "job:jobs(customer:customers(name))"   nested
 *   "quotes!inner(id)"                 a disambiguated join hint
 *
 * An embedded resource's columns belong to the EMBEDDED table, never to the
 * one being selected from — getting that wrong is what would make this check
 * unusable, since almost every select in the app embeds something.
 */
export const referencesInSelect = (
  select: string,
  table: string,
  line: number,
  endLine: number = line,
): ColumnReference[] => {
  const refs: ColumnReference[] = [];

  for (const part of splitTopLevel(select)) {
    const open = part.indexOf("(");

    if (open === -1) {
      const column = (part.includes(":") ? part.slice(part.indexOf(":") + 1) : part)
        .replace(/!.*$/, "")
        .replace(/::.*$/, "")
        .trim();
      // "*" is everything, and a bare "..." is a spread — neither names a column.
      if (!column || column === "*" || column.startsWith(".")) continue;
      refs.push({ table, column, line, endLine });
      continue;
    }

    const head = part.slice(0, open).trim();
    const body = balancedBody(part, open);
    if (body === null) continue;

    // "alias:relation(...)" names the relation after the colon; "relation(...)"
    // is the relation itself. A "!inner"/"!left" hint is not part of the name.
    const relation = (head.includes(":") ? head.slice(head.indexOf(":") + 1) : head)
      .replace(/!.*$/, "")
      .trim();

    refs.push(...referencesInSelect(body, relation, line, endLine));
  }

  return refs;
};

/**
 * Every `.from("t")…​.select("…")` pair in a source file.
 *
 * Associating them by proximity rather than by parsing the expression: a
 * select is written on the builder returned by `.from`, so the nearest
 * preceding `.from` is its table. Bounded by the next `.from(` so a select
 * belonging to a later query can never be attributed to an earlier table.
 */
export const referencesInSource = (source: string): ColumnReference[] => {
  const refs: ColumnReference[] = [];
  const fromPattern = /\.from\(\s*["'`]([\w.]+)["'`]\s*\)/g;

  const froms: Array<{ table: string; at: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = fromPattern.exec(source)) !== null) {
    froms.push({ table: bareTable(match[1]), at: match.index });
  }

  for (let i = 0; i < froms.length; i += 1) {
    const start = froms[i].at;
    const end = i + 1 < froms.length ? froms[i + 1].at : source.length;
    const window = source.slice(start, end);

    const selectPattern = /\.select\(\s*(["'`])([\s\S]*?)\1/g;
    while ((match = selectPattern.exec(window)) !== null) {
      const line = source.slice(0, start + match.index).split("\n").length;
      const endLine = line + (match[0].match(/\n/g)?.length ?? 0);
      refs.push(...referencesInSelect(match[2], froms[i].table, line, endLine));
    }
  }

  return refs;
};

export type Finding = {
  file: string;
  line: number;
  /** Last line of the select this column was named in. See ColumnReference. */
  endLine: number;
  table: string;
  column: string;
};

/**
 * Findings for one file against a schema.
 *
 * A table the migrations do not describe is SKIPPED, not reported. Selects
 * reach views, RPC results and (in tests) stubs, and a check that fires on
 * everything it does not recognise is a check people turn off. The column
 * lookup is the claim worth making: this tree says the table exists and does
 * not have this column.
 */
export const findDrift = (
  file: string,
  source: string,
  tables: Map<string, Set<string>>,
): Finding[] =>
  referencesInSource(source)
    .filter((ref) => {
      const columns = tables.get(ref.table);
      return columns !== undefined && !columns.has(ref.column.toLowerCase());
    })
    .map((ref) => ({
      file,
      line: ref.line,
      endLine: ref.endLine,
      table: ref.table,
      column: ref.column,
    }));
