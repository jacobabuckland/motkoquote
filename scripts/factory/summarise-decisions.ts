/**
 * Render the "decisions taken without you" section of the daily digest.
 *
 *   npx tsx scripts/factory/summarise-decisions.ts [--days 1] [--file areas/motko.md]
 *
 * Under the self-resolution protocol in AGENTS.md an agent that reaches a
 * judgement call takes it rather than blocking, and records it in
 * areas/motko.md. That is the whole point — a blocked ticket costs a human
 * context switch and a wrong reversible decision costs a revert — but it only
 * works if the decisions stay visible. Reversing from a digest is cheap;
 * discovering six weeks later that four tickets inherited a pattern nobody saw
 * is not.
 *
 * So this is the other half of the trade. The queue stops asking, and the
 * digest starts telling.
 *
 * `Precedent: yes` entries lead, because their cost is the one that grows: a
 * naming convention or a storage-key shape copied by the next four tickets is
 * four reverts by the time anyone looks. `Reversible: no` is called out for the
 * opposite reason — there is nothing to reverse, so the only useful moment to
 * read it was before it happened, and the least useful thing the digest can do
 * is bury it.
 *
 * Pure parsing, no network, so the rendering is exercised by tests rather than
 * only in anger at 07:00.
 */

import { readFileSync } from "node:fs";

export type Decision = {
  date: string;
  question: string;
  decision: string;
  rationale: string;
  ticket: string;
  reversible: string;
  precedent: string;
};

/**
 * One field's value, including its continuation lines. Read line by line
 * rather than with a lookahead: a `$` under the `m` flag matches end of LINE,
 * so the obvious regex silently truncates every value to its first line — and
 * these values wrap, because the record asks for two lines of rationale.
 */
const FIELD = (block: string, name: string): string => {
  const lines = block.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${name}:`));
  if (start === -1) return "";

  const value = [lines[start].slice(name.length + 1)];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Z][A-Za-z]*:/.test(line) || line.startsWith("#")) break;
    value.push(line);
  }
  return value.join(" ").trim().replace(/\s+/g, " ");
};

/**
 * Every dated entry in the record. Undated headings — the seeded "Prior"
 * decisions and the file's own prose — are deliberately skipped: they describe
 * what was already true rather than something an agent did today.
 */
export const parseDecisions = (markdown: string): Decision[] => {
  const out: Decision[] = [];
  const re = /^##\s+(\d{4}-\d{2}-\d{2})\s+—\s+(.+)$/gm;

  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const start = match.index + match[0].length;
    const next = /^##\s+/m.exec(markdown.slice(start));
    const block = markdown.slice(start, next ? start + next.index : undefined);

    const decision = FIELD(block, "Decision");
    if (!decision) continue;

    out.push({
      date: match[1],
      question: match[2].trim(),
      decision,
      rationale: FIELD(block, "Rationale"),
      ticket: FIELD(block, "Ticket"),
      reversible: FIELD(block, "Reversible").toLowerCase(),
      precedent: FIELD(block, "Precedent").toLowerCase(),
    });
  }
  return out;
};

/** Entries dated within the last `days` days of `now` (inclusive). */
export const withinWindow = (decisions: Decision[], now: Date, days: number): Decision[] => {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  return decisions.filter((d) => {
    const at = new Date(`${d.date}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at >= cutoff;
  });
};

const line = (d: Decision): string => {
  const flags = [
    d.precedent === "yes" ? "**sets a precedent**" : null,
    d.reversible === "no" ? "**not reversible**" : null,
  ].filter(Boolean);

  return [
    `### ${d.question}`,
    "",
    `- **Decided:** ${d.decision}`,
    d.rationale ? `- **Why:** ${d.rationale}` : null,
    d.ticket ? `- **Ticket:** ${d.ticket}` : null,
    flags.length ? `- ${flags.join(" · ")}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
};

export const renderDecisions = (decisions: Decision[], days: number): string => {
  if (decisions.length === 0) {
    return [
      `## Decisions taken without you — none in the last ${days === 1 ? "day" : `${days} days`}`,
      "",
      "No agent resolved a judgement call in this window. That is worth reading as a fact rather than as good news: under the protocol most judgement calls are supposed to be taken rather than asked, so a long run of empty sections means either the queue is quiet or agents are still blocking on things they should decide.",
    ].join("\n");
  }

  // Precedent first, then irreversible, then the rest — most expensive to
  // reverse at the top, since the whole section exists to be scanned.
  const rank = (d: Decision) =>
    d.precedent === "yes" ? 0 : d.reversible === "no" ? 1 : 2;
  const sorted = [...decisions].sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date));

  const precedents = sorted.filter((d) => d.precedent === "yes").length;

  return [
    `## Decisions taken without you — ${decisions.length}`,
    "",
    `Agents resolved these rather than blocking on them. Nothing here is waiting for you; it is here so you can reverse anything you disagree with while reversing is still cheap.${
      precedents > 0
        ? ` **${precedents} set${precedents === 1 ? "s" : ""} a precedent** — later tickets will copy the pattern, so the cost of changing your mind grows with each one that does.`
        : ""
    }`,
    "",
    "The full record, including the standing decisions these were checked against, is in `areas/motko.md`.",
    "",
    ...sorted.map(line).flatMap((s) => [s, ""]),
  ]
    .join("\n")
    .trimEnd();
};

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const main = (): void => {
  const days = Number(arg("days", "1"));
  const file = arg("file", "areas/motko.md");

  let markdown = "";
  try {
    markdown = readFileSync(file, "utf8");
  } catch {
    // Not fatal. A digest that dies because the record is missing takes the
    // spec disputes and the stalled sweep down with it, and those are the parts
    // someone is waiting on.
    console.log(
      `## Decisions taken without you\n\nThe decision record at \`${file}\` could not be read, so this section is empty for a reason that has nothing to do with what agents decided. That is a factory fault worth fixing before trusting the next one.`,
    );
    return;
  }

  console.log(
    renderDecisions(withinWindow(parseDecisions(markdown), new Date(), Number.isFinite(days) ? days : 1), Number.isFinite(days) ? days : 1),
  );
};

if (process.argv[1] && process.argv[1].endsWith("summarise-decisions.ts")) main();
