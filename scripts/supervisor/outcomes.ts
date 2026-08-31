/**
 * R1 — the labelled outcome dataset.
 *
 * RUNNABLE: npx tsx scripts/supervisor/outcomes.ts --since 2026-08-24 --out outcomes.json
 *
 * Every row is an OUTCOME: something that actually happened and left an
 * artefact behind. R2 may only produce a finding that cites at least three of
 * these by id, which is the whole point — a retro that can generalise from
 * impressions produces findings nobody can check, and the standing risk with
 * this factory is fluent argument on a false premise.
 *
 * "No row without a concrete artefact behind it" is enforced structurally:
 * every row carries an `artefact` (a SHA, an issue URL, a label event), and the
 * final filter drops any row that somehow reached the end without one.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { QA_REJECTION_LABEL, REPO, STOPPED_LABELS } from "./config";
import { gh, listFactoryIssues, listLabelEvents } from "./github";

export type OutcomeType =
  | "revert"
  | "fix_forward"
  | "bug_linked_to_pr"
  | "halt"
  | "qa_rejection";

export interface Outcome {
  /** Stable, human-quotable, and unique. R2 cites these. */
  id: string;
  type: OutcomeType;
  ticket: string | null;
  pr: string | null;
  date: string;
  /** The artefact: a SHA, an issue URL, a label event. Never empty. */
  artefact: string;
  detail: string;
}

/**
 * Field and record separators for `git log --pretty`.
 *
 * ASCII unit/record separators rather than a punctuation character, because a
 * commit subject can contain any punctuation you might otherwise pick — and a
 * subject containing the delimiter silently shifts every later field by one,
 * which produces rows that look plausible and are wrong.
 */
const FS = "\x1f";
const RS = "\x1e";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch {
    // A git failure is an empty dataset for that source, not a crashed retro.
    // The retro reports what it could gather; R2's ≥3-citation rule means a
    // thin dataset produces no findings rather than weak ones.
    return "";
  }
}

/**
 * The files one integration touched.
 *
 * `--first-parent` is load-bearing and is not an optimisation: `git show
 * --name-only` prints NOTHING for a merge commit, because git suppresses the
 * diff for merges unless told which parent to diff against. Without it every
 * merge returned zero files, the overlap check found nothing, and
 * `fixForwardOutcomes` could not emit a row on any input — a function that
 * typechecks, lints, runs, exits 0, and is incapable of producing output.
 */
function filesTouched(sha: string): string[] {
  return git(["show", "--first-parent", "--name-only", "--pretty=format:", sha])
    .split("\n")
    .filter(Boolean);
}

/**
 * Files that overlapping in does NOT indicate a repair.
 *
 * `areas/motko.md` is the decision ledger and AGENTS.md requires an append to
 * it in the same commit as any decision, so nearly every item touches it —
 * against the raw overlap test it made almost every pair of commits look like
 * a fix-forward, which would have flooded the retro with findings whose three
 * citations were three unrelated items that each recorded a decision. Specs and
 * lockfiles are the same shape: shared by convention, not by cause.
 */
const SHARED_BY_CONVENTION = [/^areas\//, /^docs\//, /^package-lock\.json$/, /^AGENTS\.md$/, /^CLAUDE\.md$/];

function isCausal(file: string): boolean {
  return !SHARED_BY_CONVENTION.some((pattern) => pattern.test(file));
}

function records(raw: string): string[][] {
  return raw
    .split(RS)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(FS));
}

/** Reverts: git says so, in the commit subject or the standard trailer. */
export function revertOutcomes(since: string): Outcome[] {
  const log = git([
    "log",
    `--since=${since}`,
    "--first-parent",
    "main",
    `--pretty=format:%H${FS}%aI${FS}%s${FS}%b${RS}`,
  ]);

  return records(log)
    .filter(
      ([, , subject, body]) =>
        /^revert/i.test(subject ?? "") || /^This reverts commit/m.test(body ?? ""),
    )
    .map(([sha, date, subject, body]) => {
      const reverted = (body ?? "").match(/This reverts commit ([0-9a-f]{7,40})/)?.[1];
      return {
        id: `revert:${sha.slice(0, 12)}`,
        type: "revert" as const,
        ticket: subject.match(/#(\d+)/)?.[1] ?? null,
        pr: null,
        date,
        artefact: sha,
        detail: reverted ? `${subject} (reverts ${reverted.slice(0, 12)})` : subject,
      };
    });
}

/**
 * Fix-forward: a later commit repairing files a merge touched, within 7 days.
 *
 * This is the noisiest of the five and the one most likely to over-count — two
 * items legitimately touching the same file in a week is normal work, not a
 * repair. So it requires the later commit to look like a fix (its subject says
 * so) as well as to overlap, and the row records both SHAs so a human reading a
 * finding can check whether it really was one.
 */
export function fixForwardOutcomes(since: string): Outcome[] {
  // Every FIRST-PARENT commit on main, not only the merge commits. This repo
  // integrates both ways — squash merges land as a single commit with a
  // "(#338)" suffix, and some items land as a real merge commit — and
  // `--merges` sees only the second kind, which is the minority. First-parent
  // is exactly "one entry per integration" under both conventions.
  const merges = records(
    git([
      "log",
      `--since=${since}`,
      "--first-parent",
      "main",
      `--pretty=format:%H${FS}%aI${FS}%s${RS}`,
    ]),
  );

  const out: Outcome[] = [];
  // One outcome per REPAIRING commit. A single fix can overlap several earlier
  // integrations, and emitting a row for each would give R2 three "instances"
  // that are one commit — inflating a citation count past the ≥3 bar without
  // three things having happened, which is the one way that bar can be gamed.
  const counted = new Set<string>();

  for (const [sha, date, subject] of merges) {
    const files = new Set(filesTouched(sha).filter(isCausal));
    if (files.size === 0) continue;

    const until = new Date(Date.parse(date) + 7 * 86_400_000).toISOString();
    const later = records(
      git([
        "log",
        `--since=${date}`,
        `--until=${until}`,
        "--first-parent",
        "main",
        `--pretty=format:%H${FS}%aI${FS}%s${RS}`,
      ]),
    )
      .filter(([laterSha]) => laterSha !== sha)
      .filter(([, , laterSubject]) => /\b(fix|repair|correct|hotfix|patch)\b/i.test(laterSubject));

    for (const [laterSha, laterDate, laterSubject] of later) {
      if (counted.has(laterSha)) continue;
      const overlap = filesTouched(laterSha).filter(isCausal).filter((f) => files.has(f));
      if (overlap.length === 0) continue;
      counted.add(laterSha);

      out.push({
        id: `fixforward:${laterSha.slice(0, 12)}`,
        type: "fix_forward",
        ticket: laterSubject.match(/#(\d+)/)?.[1] ?? subject.match(/#(\d+)/)?.[1] ?? null,
        pr: null,
        date: laterDate,
        artefact: `${sha.slice(0, 12)}->${laterSha.slice(0, 12)}`,
        detail: `"${laterSubject}" repaired ${overlap.length} file(s) from "${subject}": ${overlap
          .slice(0, 3)
          .join(", ")}`,
      });
      break; // One fix-forward per merge. The first repair is the outcome.
    }
  }

  return out;
}

/** Halts, with time-to-resolve from the label events that opened and closed them. */
export async function haltOutcomes(since: string): Promise<Outcome[]> {
  const events = await listLabelEvents();
  const issues = new Map((await listFactoryIssues()).map((i) => [i.number, i]));
  const out: Outcome[] = [];

  const opens = events.filter(
    (e) =>
      e.event === "labeled" &&
      (STOPPED_LABELS as readonly string[]).includes(e.label) &&
      e.created_at >= since,
  );

  for (const open of opens) {
    const close = events
      .filter(
        (e) =>
          e.issue === open.issue &&
          e.event === "unlabeled" &&
          e.label === open.label &&
          e.created_at > open.created_at,
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

    const hours = close
      ? Math.round(((Date.parse(close.created_at) - Date.parse(open.created_at)) / 3_600_000) * 10) /
        10
      : null;

    out.push({
      id: `halt:${open.issue}:${open.label}:${open.created_at}`,
      type: "halt",
      ticket: String(open.issue),
      pr: null,
      date: open.created_at,
      artefact: `https://github.com/${REPO}/issues/${open.issue}`,
      detail:
        `${open.label} on "${issues.get(open.issue)?.title ?? `#${open.issue}`}" — ` +
        (hours === null ? "still open" : `resolved after ${hours}h`),
    });
  }

  return out;
}

/**
 * QA rejections, with the reason line.
 *
 * The reason is the first substantial line of the QA comment nearest the
 * rejection event. A rejection with no readable reason is still an outcome —
 * it happened — so it is recorded with the reason stated as unavailable rather
 * than dropped, because dropping it would bias the rate downwards precisely on
 * the rejections that were worst explained.
 */
export async function qaRejectionOutcomes(since: string): Promise<Outcome[]> {
  const events = (await listLabelEvents()).filter(
    (e) => e.event === "labeled" && e.label === QA_REJECTION_LABEL && e.created_at >= since,
  );

  const out: Outcome[] = [];
  for (const e of events) {
    const comments = await gh<{ body: string; created_at: string }[]>(
      `/repos/${REPO}/issues/${e.issue}/comments?per_page=100`,
    );
    const nearest = (comments ?? [])
      .filter((c) => c.created_at <= e.created_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

    const reason =
      nearest?.body
        ?.split("\n")
        .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
        .find((l) => l.length > 20) ?? "(no reason line found on the issue)";

    out.push({
      id: `qa:${e.issue}:${e.created_at}`,
      type: "qa_rejection",
      ticket: String(e.issue),
      pr: null,
      date: e.created_at,
      artefact: `https://github.com/${REPO}/issues/${e.issue}`,
      detail: reason.slice(0, 200),
    });
  }
  return out;
}

/** Bugs whose body names the PR or issue that introduced them. */
export async function bugOutcomes(since: string): Promise<Outcome[]> {
  const issues = await listFactoryIssues();
  return issues
    .filter((i) => i.created_at >= since)
    .filter((i) => /\bintroduc(?:ed|ing)\b|\bregression from\b|\bcaused by\b/i.test(i.body ?? ""))
    .map((i) => {
      const ref = (i.body ?? "").match(/#(\d+)/)?.[1] ?? null;
      return {
        id: `bug:${i.number}`,
        type: "bug_linked_to_pr" as const,
        ticket: String(i.number),
        pr: ref ? `https://github.com/${REPO}/pull/${ref}` : null,
        date: i.created_at,
        artefact: i.html_url,
        detail: i.title,
      };
    });
}

async function main(): Promise<void> {
  const since = arg("since") ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const out = arg("out") ?? "supervisor-outcomes.json";

  const rows: Outcome[] = [
    ...revertOutcomes(since),
    ...fixForwardOutcomes(since),
    ...(await haltOutcomes(since)),
    ...(await qaRejectionOutcomes(since)),
    ...(await bugOutcomes(since)),
  ]
    // The structural guarantee, checked rather than assumed.
    .filter((r) => r.artefact.trim().length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);

  console.log(`${rows.length} outcome(s) since ${since}`);
  console.log(["ID", "TYPE", "TICKET", "PR", "DATE"].join("\t"));
  for (const r of rows) {
    console.log([r.id, r.type, r.ticket ?? "-", r.pr ?? "-", r.date].join("\t"));
  }
}

if (process.argv[1]?.endsWith("outcomes.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
