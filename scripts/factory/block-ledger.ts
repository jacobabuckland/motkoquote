/**
 * A durable record of every block, and what it cost.
 *
 * WHY. Intervention cost is currently unmeasurable. `resume.sh` strips the
 * stopped label and ship clears the stage labels, so an item blocked, resumed
 * and shipped leaves no trace at all — this week two such cases could only be
 * proved from one session's own memory. That makes "the factory blocks too
 * much" and "the factory blocked a lot last Tuesday for four reasons since
 * fixed" indistinguishable, and decisions get made on impressions.
 *
 * Records live as comments on the tracker issue, which is the one place labels
 * cannot reach. They are append-only: a `block` record when a stopped label goes
 * on, a `resolution` record when it comes off.
 *
 * Categorisation is heuristic and says so. `unknown` is a legitimate outcome and
 * is never avoided by guessing — a run of unknowns is a finding about
 * diagnosability, not a gap to paper over.
 */

export const BLOCK_MARKER = "<!-- factory-block-record";

export const CATEGORIES = [
  "factory-defect",
  "contract-decay",
  "spec-error",
  "implementation",
  "infrastructure",
  "unknown",
] as const;
export type BlockCategory = (typeof CATEGORIES)[number];

export const CATEGORY_MEANING: Record<BlockCategory, string> = {
  "factory-defect": "a guard misfired — the work was not at fault",
  "contract-decay": "a frozen file was invalidated, usually by main moving",
  "spec-error": "the Engineer disputed the contract and was right",
  implementation: "the work was genuinely wrong",
  infrastructure: "transient — the run died before it judged anything",
  unknown: "the evidence did not determine a cause",
};

export interface BlockRecord {
  kind: "block" | "resolution";
  issue: number;
  label: string;
  at: string;
  /** Branch head at the moment of the event. The refinement below turns on it. */
  sha: string | null;
  stage: string | null;
  failingStep: string | null;
  category: BlockCategory;
  /** null until resolution, when it can actually be known. */
  neededHuman: boolean | null;
  minutesBlocked: number | null;
}

export interface CategoryEvidence {
  /** blocked | qa-disputed | spec-dispute | reconciler-escalated */
  label: string;
  /** The most recent blocking comment on the item. */
  comment: string;
  /** Files the failure was ATTRIBUTED to that are frozen. Not mere mentions. */
  frozenAttributed: string[];
  /** Every file the failure was attributed to. */
  failingSources: string[];
  failingStep: string | null;
}

/**
 * Best-effort cause at block time.
 *
 * Deliberately does NOT emit `factory-defect`: whether a guard misfired is not
 * knowable while it is misfiring — it is knowable at resolution, when the branch
 * turns out not to have changed. See `refineOnResolution`.
 */
export function categorise(evidence: CategoryEvidence): BlockCategory {
  const { label, comment, frozenAttributed, failingSources, failingStep } = evidence;

  if (label === "spec-dispute" || /^\s*SPEC ERROR:/m.test(comment)) return "spec-error";

  // The run died before it judged anything: nothing was attributed AND the step
  // that failed is one that runs before the work is assessed.
  const preJudgement = /checkout|setup|npm ci|Materialise|never reported|could not be determined/i;
  if (failingSources.length === 0) {
    if (failingStep !== null && preJudgement.test(failingStep)) return "infrastructure";
    if (/could not be attributed|no run at all|could not be retrieved/i.test(comment)) {
      return "unknown";
    }
    return "unknown";
  }

  if (frozenAttributed.length > 0) return "contract-decay";
  return "implementation";
}

/**
 * What the resolution reveals that the block could not.
 *
 * If the branch head is identical at block and at resolution, nothing about the
 * work changed and yet the item stopped being blocked — so the block was not
 * about the work. That is the only reliable signal for `factory-defect`, and it
 * is only available in hindsight. Every one of this week's blocks would have
 * qualified.
 *
 * Never overrides `spec-error`: correcting a spec amends the branch's first
 * commit, so the SHA changes anyway, and the dispute is a better description of
 * what happened than "a guard misfired".
 */
export function refineOnResolution(
  blockCategory: BlockCategory,
  shaAtBlock: string | null,
  shaAtResolution: string | null,
): BlockCategory {
  if (blockCategory === "spec-error") return blockCategory;
  if (shaAtBlock === null || shaAtResolution === null) return blockCategory;
  if (shaAtBlock !== shaAtResolution) return blockCategory;
  return "factory-defect";
}

/**
 * Whether clearing it took a person.
 *
 * Every stopped state exists to ask a human a question, so its removal is a
 * human act by construction. The exception is `reconciler-escalated`, which the
 * reconciler clears by itself once the observed state moves on.
 */
export function neededHumanFor(label: string, clearedByReconciler: boolean): boolean {
  if (label === "reconciler-escalated" && clearedByReconciler) return false;
  return true;
}

export function renderRecord(record: BlockRecord): string {
  const human =
    record.neededHuman === null ? "pending" : record.neededHuman ? "human" : "automatic";
  const headline =
    record.kind === "block"
      ? `**Blocked** — #${record.issue} at \`${record.label}\`, cause \`${record.category}\``
      : `**Unblocked** — #${record.issue} was \`${record.label}\` for ${record.minutesBlocked ?? "?"} min, cause \`${record.category}\`, cleared ${human}`;

  return [
    headline,
    "",
    `_${CATEGORY_MEANING[record.category]}._`,
    "",
    `${BLOCK_MARKER}`,
    JSON.stringify(record),
    `-->`,
  ].join("\n");
}

export function parseRecords(bodies: string[]): BlockRecord[] {
  const records: BlockRecord[] = [];
  for (const body of bodies) {
    const match = new RegExp(`${BLOCK_MARKER}\\s*([\\s\\S]*?)-->`).exec(body);
    if (!match) continue;
    try {
      const parsed = JSON.parse(match[1]) as BlockRecord;
      if (typeof parsed.issue === "number" && (parsed.kind === "block" || parsed.kind === "resolution")) {
        records.push(parsed);
      }
    } catch {
      // A malformed record is dropped rather than throwing. Losing one row is
      // survivable; losing the digest that reports the rest is not.
    }
  }
  return records;
}

export interface WeeklySummary {
  blocked: number;
  resolved: number;
  neededHuman: number;
  byCategory: Record<string, number>;
  medianMinutes: number | null;
}

export function summarise(records: BlockRecord[], now: string, days = 7): WeeklySummary {
  const cutoff = Date.parse(now) - days * 24 * 60 * 60 * 1000;
  const recent = records.filter((r) => Date.parse(r.at) >= cutoff);

  const blocks = recent.filter((r) => r.kind === "block");
  const resolutions = recent.filter((r) => r.kind === "resolution");

  const byCategory: Record<string, number> = {};
  // Categorise by the RESOLUTION where there is one, since that is the reading
  // that had the most evidence. Blocks still open count under their block-time
  // category, which is the best that is known about them.
  const resolvedIssues = new Set(resolutions.map((r) => r.issue));
  for (const r of resolutions) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  for (const b of blocks) {
    if (resolvedIssues.has(b.issue)) continue;
    byCategory[b.category] = (byCategory[b.category] ?? 0) + 1;
  }

  const durations = resolutions
    .map((r) => r.minutesBlocked)
    .filter((m): m is number => typeof m === "number")
    .sort((a, b) => a - b);
  const medianMinutes =
    durations.length === 0
      ? null
      : durations.length % 2 === 1
        ? durations[(durations.length - 1) / 2]
        : Math.round((durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2);

  return {
    blocked: blocks.length,
    resolved: resolutions.length,
    neededHuman: resolutions.filter((r) => r.neededHuman === true).length,
    byCategory,
    medianMinutes,
  };
}

export function renderWeeklyLine(summary: WeeklySummary, days = 7): string {
  if (summary.blocked === 0 && summary.resolved === 0) {
    return [
      `## Blocks — last ${days} days`,
      "",
      "No blocks recorded. If that looks wrong, the ledger is the thing to check: an empty ledger and a quiet factory look identical from here.",
    ].join("\n");
  }

  const categories = Object.entries(summary.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `- \`${name}\` × ${count} — ${CATEGORY_MEANING[name as BlockCategory] ?? "unrecognised category"}`);

  return [
    `## Blocks — last ${days} days`,
    "",
    `**${summary.blocked} blocked, ${summary.resolved} cleared, ${summary.neededHuman} of those needed a person.**` +
      (summary.medianMinutes !== null ? ` Median time blocked: ${summary.medianMinutes} min.` : ""),
    "",
    ...categories,
    "",
    "_Categories are heuristic. `unknown` means the evidence did not determine a cause and was not guessed at; a run of them is a finding about diagnosability rather than a gap to fill in._",
  ].join("\n");
}
