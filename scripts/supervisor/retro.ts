/**
 * R2 and R3 — the weekly retro.
 *
 * RUNNABLE: npx tsx scripts/supervisor/retro.ts --outcomes outcomes.json --snapshots supervisor/history --out retro.md
 *
 * Groups R1's outcomes by pattern, and produces one finding per pattern with at
 * least three instances. Every finding cites its outcome ids and carries a
 * mandatory routing choice.
 *
 * The ≥3 rule and the citation rule are enforced HERE, in code, rather than
 * asked for in the model's prompt. That is deliberate and it is the lesson of
 * the last fortnight: agent reasoning and agent conclusions fail independently,
 * and three separate runs have argued fluently from a false premise. A finding
 * that cannot name three artefacts never reaches the page, whatever the prose
 * around it says.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Outcome } from "./outcomes";
import type { Snapshot } from "./types";

/** §R2's five routes. A finding must pick exactly one. */
export const ROUTES = [
  "CI check / lint",
  "codemod + removal of existing instances",
  "fixture test",
  "AGENTS.md line",
  "ticket-template change",
] as const;
export type Route = (typeof ROUTES)[number];

export interface Finding {
  pattern: string;
  route: Route;
  citations: string[];
  /** Required when and only when the route is the AGENTS.md line (§R2's AC). */
  why_not_other_routes?: string;
}

export interface HaltVerdict {
  id: string;
  ticket: string | null;
  verdict: "necessary" | `rule-missing: ${string}`;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * The pattern key an outcome falls under.
 *
 * Kept coarse on purpose. A key derived from the outcome's free text would
 * split three instances of one problem into three patterns of one, and the ≥3
 * rule would then never fire — a grouping that can never reach the threshold is
 * indistinguishable from a factory with no recurring problems, and the second
 * is a much more comfortable conclusion to arrive at wrongly.
 */
export function patternKey(outcome: Outcome): string | null {
  const text = `${outcome.detail} ${outcome.id}`.toLowerCase();

  // `\btype\b` does NOT match "typecheck" — the boundary fails mid-word — and
  // "typecheck" is by far the commonest way this appears in a commit subject.
  // Spell the variants out rather than reaching for a cleverer boundary.
  if (/typecheck|type-check|typescript|\btsc\b|\bts\d{4}\b/.test(text)) return "typecheck failures";
  if (/\blint\b|eslint/.test(text)) return "lint failures";
  if (/\bacceptance test\b|\bfrozen\b|\bcontract\b/.test(text)) return "acceptance-test contracts";
  if (/\bmigration\b|\bschema\b|\bsupabase\b/.test(text)) return "schema and migrations";
  if (/\bflake\b|\bflaky\b|\btimeout\b|\brunner\b/.test(text)) return "CI flakiness";
  if (/\bstub\b|\bnot implemented\b|\bplaceholder\b/.test(text)) return "unimplemented stubs reaching QA";
  if (/\bdecision\b|\bambiguous\b|\bunclear\b/.test(text)) return "specs blocking on ambiguity";

  // An unclassified outcome belongs to NO pattern, and must not be lumped with
  // every other unclassified one.
  //
  // This returned `${type} (unclassified)` and would have filed a ticket on the
  // first live retro: fourteen unrelated halts — a Stripe fee change, a spec
  // dispute, a QA disagreement — collapsed into one "pattern", cleared the
  // three-instance bar on volume alone, and routed to `AGENTS.md line` because
  // that is the fallback route. Every Monday, for ever.
  //
  // That is the exact failure the >=3 bar exists to prevent, arrived at through
  // the bar rather than around it. Three instances of ONE problem is a pattern;
  // fourteen things that share only "we could not classify them" is a pile, and
  // a written rule proposed from a pile is worse than no finding.
  //
  // They are counted and reported in the retro prose instead, so a human can
  // see the classifier is missing something without a ticket being filed about
  // it.
  return null;
}

/**
 * Which of the five routes a pattern should take.
 *
 * `AGENTS.md line` is the LAST resort, and the function reflects that: a
 * pattern only reaches it when no mechanical route can express the rule. The
 * board's own history is the argument — an AGENTS.md line is advice an agent
 * may read and still not follow, and the same three classes of mistake have
 * recurred in the presence of a line telling agents not to make them.
 */
export function routeFor(pattern: string): { route: Route; whyNot?: string } {
  switch (pattern) {
    case "typecheck failures":
    case "lint failures":
      return { route: "CI check / lint" };
    case "acceptance-test contracts":
      return { route: "fixture test" };
    case "schema and migrations":
      return { route: "CI check / lint" };
    case "CI flakiness":
      return { route: "fixture test" };
    case "unimplemented stubs reaching QA":
      return { route: "CI check / lint" };
    case "specs blocking on ambiguity":
      return {
        route: "ticket-template change",
      };
    default:
      return {
        route: "AGENTS.md line",
        whyNot:
          "No mechanical route can express this pattern: the outcomes it groups do not share a " +
          "detectable code shape (so no lint or CI check can name them), do not share a call site " +
          "(so no codemod applies), and are not reproducible from a fixture. The ticket template " +
          "cannot carry it either, because the pattern appears after the card is written. That " +
          "leaves a written rule — which is the weakest of the five and is why this route requires " +
          "this paragraph.",
      };
  }
}

/** §R2: one finding per pattern with ≥3 instances, each citing its outcome ids. */
export function findings(outcomes: Outcome[]): Finding[] {
  const groups = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    const key = patternKey(o);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }

  const out: Finding[] = [];
  for (const [pattern, group] of groups) {
    if (group.length < 3) continue;

    const { route, whyNot } = routeFor(pattern);
    const finding: Finding = {
      pattern,
      route,
      citations: group.map((o) => o.id),
    };
    if (route === "AGENTS.md line") finding.why_not_other_routes = whyNot;
    out.push(finding);
  }

  // The AC, checked rather than trusted. A finding that reaches here without
  // three citations is a bug in the grouping above, and it must not be
  // published as though a human could check it.
  return out.filter((f) => f.citations.length >= 3);
}

/**
 * R3 — one verdict per halt closed in the week.
 *
 * `rule-missing` is proposed only when the halt's own text points at a recorded
 * decision or a standing rule, because that is the only case where the claim
 * "this was already answered" is checkable. Anything else is `necessary` — the
 * conservative verdict, and the right default: calling a halt unnecessary when
 * it was not teaches the scoping agent to push through a question it should
 * have asked, and the fee-visibility question that surfaced as an incident on
 * 20 August is what that costs.
 */
const RULE_MISSING_REASON =
  "the answer was already recorded — the blocking path should consult areas/motko.md and " +
  'AGENTS.md before emitting DECISION NEEDED, per the "Before you are permitted to block" protocol';

export function haltVerdicts(outcomes: Outcome[]): HaltVerdict[] {
  return outcomes
    .filter((o) => o.type === "halt" && /resolved after/.test(o.detail))
    .map((o) => {
      const text = o.detail.toLowerCase();

      const derivable =
        /\balready (decided|recorded|answered)\b/.test(text) ||
        /\bareas\/motko\.md\b/.test(text) ||
        /\bagents\.md\b/.test(text) ||
        /\bper the (ticket|card|spec)\b/.test(text);

      // A template literal, not a concatenation: `verdict` is typed
      // `` `rule-missing: ${string}` ``, and `+` widens the result to plain
      // `string`, which does not assign back to it.
      const verdict: HaltVerdict["verdict"] = derivable
        ? `rule-missing: ${RULE_MISSING_REASON}`
        : "necessary";

      return { id: o.id, ticket: o.ticket, verdict };
    });
}

/** Outcomes the classifier could not place. Reported, never filed. */
export function unclassifiedCount(outcomes: Outcome[]): number {
  return outcomes.filter((o) => patternKey(o) === null).length;
}

export function renderRetro(
  found: Finding[],
  verdicts: HaltVerdict[],
  window: string,
  unclassified = 0,
): string {
  const lines: string[] = [`## Retro — week to ${window}`, ""];

  if (found.length === 0) {
    lines.push(
      "No pattern reached three instances this week. Nothing filed — a finding below the threshold " +
        "is an anecdote, and filing anecdotes is how a retro stops being read.",
      "",
    );
  } else {
    for (const f of found) {
      lines.push(`### ${f.pattern} → ${f.route}`);
      lines.push(`Cited outcomes (${f.citations.length}): ${f.citations.join(", ")}`);
      if (f.why_not_other_routes) lines.push("", `Why not the other four routes: ${f.why_not_other_routes}`);
      lines.push("");
    }
  }

  if (unclassified > 0) {
    lines.push(
      `${unclassified} outcome${unclassified === 1 ? "" : "s"} did not match any pattern and ` +
        "were not grouped. That is reported rather than filed: things that share only " +
        "\"unclassified\" are a pile, not a pattern. A number that stays high is a sign the " +
        "classifier needs a new rule, not that the factory has one big problem.",
      "",
    );
  }

  lines.push("### Halt review");
  if (verdicts.length === 0) {
    lines.push("- No halts closed this week.");
  } else {
    for (const v of verdicts) {
      lines.push(`- ${v.ticket ? `#${v.ticket}` : v.id}: ${v.verdict}`);
    }
  }

  return lines.join("\n");
}

/** The Roadmap ticket title R2 files a finding under, routing included (§R2). */
export function findingTitle(finding: Finding): string {
  return `[retro] ${finding.pattern} → ${finding.route}`;
}

function loadOutcomes(path: string | undefined): Outcome[] {
  if (!path) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Outcome[];
  } catch {
    return [];
  }
}

function latestWindow(dir: string): string {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    const last = files[files.length - 1];
    const snap = JSON.parse(readFileSync(join(dir, last), "utf8")) as Snapshot;
    return snap.taken_at.slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function main(): void {
  const outcomes = loadOutcomes(arg("outcomes"));
  const window = latestWindow(arg("snapshots") ?? "supervisor/history");

  const found = findings(outcomes);
  const verdicts = haltVerdicts(outcomes);
  const markdown = renderRetro(found, verdicts, window, unclassifiedCount(outcomes));

  writeFileSync(arg("out") ?? "supervisor-retro.md", `${markdown}\n`);

  // The findings are written separately so the workflow can file each as a
  // `Needs spec` Roadmap ticket without re-parsing the markdown.
  writeFileSync(
    arg("findings-out") ?? "supervisor-findings.json",
    `${JSON.stringify(found.map((f) => ({ ...f, title: findingTitle(f) })), null, 2)}\n`,
  );

  console.log(markdown);
}

if (process.argv[1]?.endsWith("retro.ts")) {
  main();
}
