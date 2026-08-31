/**
 * The snapshot's decision logic, with no I/O.
 *
 * Same separation as `reconcile-core.ts`, for the same reason: what the
 * supervisor concludes must be testable against state rather than against a
 * live board. Everything here is a pure function of what was read.
 */

import {
  FACTORY_IDLE_HOURS,
  KNOWN_MODULES,
  KNOWN_STATUSES,
  MODULE_ALIASES,
  THRESHOLDS,
  type TicketStatus,
} from "./config";
import type { NotionHealth, Snapshot, TicketSnapshot } from "./types";

export function hoursBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 3_600_000;
}

/** §5: `payment` and `payments` group as one; the raw string is what is stored. */
export function normaliseModule(raw: string): string {
  return MODULE_ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();
}

export function isKnownStatus(value: string): value is TicketStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(value);
}

export function isKnownModule(raw: string): boolean {
  return (KNOWN_MODULES as readonly string[]).includes(normaliseModule(raw));
}

/**
 * Which staleness thresholds a ticket has crossed, as `<page_id>:<key>` ids.
 *
 * The id encodes the status as well as the hours so that a ticket which leaves
 * and re-enters a state produces a DIFFERENT id only when it re-crosses —
 * §6.7's "fires once per crossing; re-fires only after the ticket leaves and
 * re-enters the state". `status_since` moving is what makes that work: it is
 * reset on entry, so the crossing is recomputed from the new entry time and
 * the diff sees the id disappear and come back.
 */
export function crossedThresholds(
  pageId: string,
  ticket: TicketSnapshot,
  now: string,
): string[] {
  const hours = THRESHOLDS[ticket.status as keyof typeof THRESHOLDS];
  if (hours === undefined) return [];
  if (hoursBetween(ticket.status_since, now) < hours) return [];

  const key = ticket.status.toLowerCase().replace(/\s+/g, "_");
  return [`${pageId}:${key}_${hours}h`];
}

/**
 * §5's last row: something has been `Ready for factory` for over two hours and
 * nothing is `In factory`. The poller is presumed dead.
 *
 * A board with nothing queued is NOT idle — it is empty, which is a different
 * thing and not a fault. Conflating them would have the supervisor file a bug
 * every time the queue drained.
 */
export function computeFactoryIdle(tickets: Record<string, TicketSnapshot>, now: string): boolean {
  const values = Object.values(tickets);
  if (values.some((t) => t.status === "In factory")) return false;

  return values.some(
    (t) => t.status === "Ready for factory" && hoursBetween(t.status_since, now) >= FACTORY_IDLE_HOURS,
  );
}

/**
 * Health findings over the raw board.
 *
 * `unknown_module_values` deliberately excludes both spellings of payments:
 * §5 says report a third variant only. Both known spellings normalise to the
 * same value, so neither can appear here, and a genuine third one will.
 */
export function computeHealth(
  rows: { title: string | null; status: string | null; module: string | null }[],
  unlinked: number,
): NotionHealth {
  const unknownStatuses = new Set<string>();
  const unknownModules = new Set<string>();
  let nullTitles = 0;

  for (const row of rows) {
    if (row.title === null) nullTitles++;
    if (row.status && !isKnownStatus(row.status)) unknownStatuses.add(row.status);
    if (row.module && !isKnownModule(row.module)) unknownModules.add(row.module);
  }

  return {
    null_title_rows: nullTitles,
    unknown_status_values: [...unknownStatuses].sort(),
    unknown_module_values: [...unknownModules].sort(),
    unlinked,
  };
}

/**
 * `status_since`, in the order the S0 record fixes.
 *
 * The GitHub label event is authoritative because `factory-notion-status.yml`
 * derives Notion's Status from exactly those labels. Carry-forward is second
 * because it is correct whenever the status has not changed. `taken_at` is last
 * and applies only to a ticket seen for the first time — which is why a fresh
 * `factory-state` branch does not immediately report the whole board as stale:
 * every ticket starts its clock now, and the thresholds fire later, on real
 * elapsed time.
 *
 * `last_edited_time` appears nowhere in this chain, deliberately. Every
 * unrelated edit to a card would otherwise reset its staleness, which is the
 * failure the hard constraint names.
 */
export function resolveStatusSince(
  fromEvents: string | null,
  previous: TicketSnapshot | undefined,
  currentStatus: string,
  takenAt: string,
): string {
  if (fromEvents) return fromEvents;
  if (previous && previous.status === currentStatus) return previous.status_since;
  return takenAt;
}

/** A snapshot that must never be diffed against. */
export function isDiffable(snapshot: Snapshot | null): snapshot is Snapshot {
  return Boolean(snapshot) && snapshot?.partial !== true;
}
