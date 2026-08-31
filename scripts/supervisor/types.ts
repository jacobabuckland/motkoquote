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

export interface NotionHealth {
  null_title_rows: number;
  unknown_status_values: string[];
  unknown_module_values: string[];
  /** Pages whose GitHub linkage did not resolve. Reported once, then ignored. */
  unlinked: number;
}

export interface Snapshot {
  taken_at: string;
  main: { sha: string; ci: CiState; run_url: string | null };
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
