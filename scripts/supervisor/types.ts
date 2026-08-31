/**
 * The snapshot shape (§5) and the change-event shape (§6).
 *
 * Both are written to disk and read back by a later run, so they are a wire
 * format, not an internal convenience. Adding a field is safe; changing the
 * meaning of one is not, because the previous snapshot was written by the
 * previous version of this file.
 */

import type { TicketStatus } from "./config";

export type CiState = "green" | "red" | "pending";
export type PreviewStatus = "ready" | "failed" | "building" | "unknown";
export type Db = "bugs" | "roadmap";

export interface TicketSnapshot {
  db: Db;
  name: string;
  status: TicketStatus | string;
  module: string;
  /**
   * When the ticket entered its current status. Derived from the GitHub label
   * event that produced it, else carried forward from the previous snapshot,
   * else this run's `taken_at`. NEVER `last_edited_time` — see the hard
   * constraint in the spec and the decision record in areas/motko.md.
   */
  status_since: string;
  /** The factory issue this page is linked to, if the linkage resolved. */
  issue: number | null;
  pr: string | null;
  preview_url: string | null;
  preview_status: PreviewStatus;
  halt_open: boolean;
  qa_rejections: number;
}

/**
 * Board-health findings.
 *
 * The three linkage counts were one number until the first live run reported
 * `unlinked: 86` out of 185 tickets, which read as 86 broken links and was not
 * one fact. It was three: 42 rows with no GitHub reference at all, 38 pointing
 * deliberately at a pull request, and 6 pointing at an issue outside the
 * `factory` label. Those want three different responses — derive them, nothing,
 * and go and look — so one number standing in for all three is the same shape
 * of error as an absent answer read as a passing one.
 */
export interface NotionHealth {
  null_title_rows: number;
  unknown_status_values: string[];
  unknown_module_values: string[];
  /** Pages with no GitHub reference of any kind. Reported once, then ignored. */
  unlinked: number;
  /**
   * Pages whose `GitHub Issue` property is a pull request.
   *
   * Not a fault — the Bugs board links the PR that fixed the bug — but the
   * supervisor cannot read labels, halts or QA rejections off a PR, so these
   * tickets are invisible to §4.2 and §4.3 and that has to be visible.
   */
  linked_to_pr: number;
  /**
   * Pages naming an issue that is not in the factory set: no `factory` label,
   * or carrying `factory-meta`. Either the label is missing or the reference is
   * stale, and both are worth a look.
   */
  linked_outside_factory: number;
}

/**
 * The live-checks lane's state (`rls-check.yml`).
 *
 * Separate from `main` because it answers a different question. `main.ci` says
 * whether the TREE is sound; this says whether PRODUCTION is. A commit can be
 * green while production has an open RLS gap, an unexpected column, or — as on
 * 31 Aug — a SECURITY DEFINER function callable by `anon`.
 */
export interface LiveChecks {
  state: CiState;
  run_url: string | null;
  completed_at: string | null;
  /** No completed run within LIVE_CHECKS_STALE_HOURS: the lane has stopped firing. */
  stale: boolean;
}

export interface Snapshot {
  taken_at: string;
  main: { sha: string; ci: CiState; run_url: string | null };
  live_checks: LiveChecks;
  tickets: Record<string, TicketSnapshot>;
  thresholds_crossed: string[];
  notion_health: NotionHealth;
  factory_idle: boolean;
  /** Recorded by publish.ts on first run so the page id is stable (S3). */
  supervisor_page_id?: string | null;
  /** T1's cooldown ledger: page id → ISO timestamp of the last retry. */
  preview_retries?: Record<string, string>;
  /** Set when the snapshot is a partial read that must not be diffed. */
  partial?: boolean;
}

export type ChangeEventKind =
  | "status_transition"
  | "new_ticket"
  | "ci_flip"
  | "preview_failed"
  | "preview_recovered"
  | "halt_opened"
  | "halt_closed"
  | "threshold_crossed"
  | "qa_rejection"
  | "factory_idle_flip"
  | "live_checks_flip"
  | "live_checks_stale"
  | "notion_health";

export interface ChangeEvent {
  kind: ChangeEventKind;
  /** Notion page id, or null for events that are not about one ticket. */
  page_id: string | null;
  /** Human-readable ticket name, for the digest. */
  name?: string;
  from?: string;
  to?: string;
  detail?: string;
  url?: string;
}

export interface ActionRecord {
  /** What was done, one line. */
  action: string;
  page_id: string | null;
  /** How to undo it. §7: every action carries one. */
  reversal: string;
}
