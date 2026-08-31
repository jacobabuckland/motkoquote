/**
 * S2 — the ten change events of §6, computed from two snapshots.
 *
 * Pure. No I/O, no clock, no network: everything it decides is a function of
 * the pair it is handed. That is what makes D8 enforceable — the model is
 * invoked only when this returns a non-empty list, and a list computed by a
 * deterministic function of two files is one you can put a fixture behind.
 *
 * The §6 exclusion list matters as much as the inclusion list, and each
 * exclusion is a real thing that would otherwise fire every hour:
 *
 *   - `status_since` ticking: it moves in real time by construction.
 *   - `main` SHA advancing with CI still green: that is the factory working.
 *   - preview `building` → `ready`: the expected path, not news.
 *   - `preview_status: unknown`: absence of evidence, and §4.4 makes it common.
 *
 * A digest line with no backing event here is a defect (§8), so anything this
 * function does not emit cannot be reported.
 */

import type { ChangeEvent, Snapshot, TicketSnapshot } from "./types";

/** Only these transitions are worth a preview event. */
function previewEvent(
  before: TicketSnapshot | undefined,
  after: TicketSnapshot,
): "preview_failed" | "preview_recovered" | null {
  const from = before?.preview_status ?? "unknown";
  const to = after.preview_status;

  // `unknown` is never a change event in either direction (§6). A ticket whose
  // deployment has aged out of the API window must not read as a recovery, and
  // one the API has not answered for yet must not read as a failure.
  if (to === "unknown" || from === "unknown") return null;

  if (to === "failed" && from !== "failed") return "preview_failed";
  if (from === "failed" && to !== "failed") return "preview_recovered";
  return null;
}

export function computeEvents(previous: Snapshot | null, current: Snapshot): ChangeEvent[] {
  const events: ChangeEvent[] = [];

  // FIRST RUN. There is no previous state, so every ticket is technically new
  // and every threshold technically just crossed — which would emit a digest
  // naming the entire board and teach whoever reads it that the digest is
  // noise. The first run establishes the baseline and reports nothing; the
  // second run is the first that can say anything true about change.
  if (!previous) return events;

  /* -- 1, 2: ticket status transitions and new tickets ---------------------- */
  for (const [pageId, after] of Object.entries(current.tickets)) {
    const before = previous.tickets[pageId];

    if (!before) {
      events.push({
        kind: "new_ticket",
        page_id: pageId,
        name: after.name,
        from: "new",
        to: after.status,
      });
      continue;
    }

    if (before.status !== after.status) {
      events.push({
        kind: "status_transition",
        page_id: pageId,
        name: after.name,
        from: before.status,
        to: after.status,
      });
    }

    /* -- 4: preview failed or recovered ------------------------------------ */
    const preview = previewEvent(before, after);
    if (preview) {
      events.push({
        kind: preview,
        page_id: pageId,
        name: after.name,
        from: before.preview_status,
        to: after.preview_status,
        url: after.preview_url ?? undefined,
      });
    }

    /* -- 5, 6: halts open and close ---------------------------------------- */
    if (!before.halt_open && after.halt_open) {
      events.push({ kind: "halt_opened", page_id: pageId, name: after.name });
    }
    if (before.halt_open && !after.halt_open) {
      events.push({ kind: "halt_closed", page_id: pageId, name: after.name });
    }

    /* -- 8: QA rejection count increments ---------------------------------- */
    if (after.qa_rejections > before.qa_rejections) {
      events.push({
        kind: "qa_rejection",
        page_id: pageId,
        name: after.name,
        from: String(before.qa_rejections),
        to: String(after.qa_rejections),
      });
    }
  }

  /* -- 3: main CI flips ----------------------------------------------------- */
  // A flip, not a state. `pending` is a waypoint on the way to both, so a
  // transition through it is not news in either direction — only green↔red is.
  const wasCi = previous.main.ci;
  const nowCi = current.main.ci;
  if (wasCi !== nowCi && wasCi !== "pending" && nowCi !== "pending") {
    events.push({
      kind: "ci_flip",
      page_id: null,
      from: wasCi,
      to: nowCi,
      url: current.main.run_url ?? undefined,
      detail: current.main.sha.slice(0, 7),
    });
  }

  /* -- 7: staleness threshold crossings ------------------------------------- */
  // Set difference on the crossing ids. A ticket that leaves and re-enters a
  // state gets a fresh `status_since`, so its id disappears from the set and
  // reappears when the clock is re-run — which is exactly "re-fires only after
  // the ticket leaves and re-enters".
  const before = new Set(previous.thresholds_crossed);
  for (const id of current.thresholds_crossed) {
    if (before.has(id)) continue;
    const pageId = id.split(":")[0];
    events.push({
      kind: "threshold_crossed",
      page_id: pageId,
      name: current.tickets[pageId]?.name,
      detail: id.split(":")[1],
    });
  }

  /* -- 9: factory_idle flips ------------------------------------------------ */
  if (previous.factory_idle !== current.factory_idle) {
    events.push({
      kind: "factory_idle_flip",
      page_id: null,
      from: String(previous.factory_idle),
      to: String(current.factory_idle),
    });
  }

  /* -- 10: Notion health GAINS a finding ------------------------------------ */
  // Gains only. A finding that is still present is not new, and re-reporting it
  // every hour is how a digest becomes wallpaper. It clearing is also not an
  // event — nothing is waiting on the good news.
  const h0 = previous.notion_health;
  const h1 = current.notion_health;

  if (h1.null_title_rows > h0.null_title_rows) {
    events.push({
      kind: "notion_health",
      page_id: null,
      detail: `null-title rows ${h0.null_title_rows} → ${h1.null_title_rows}`,
    });
  }
  for (const value of h1.unknown_status_values) {
    if (!h0.unknown_status_values.includes(value)) {
      events.push({ kind: "notion_health", page_id: null, detail: `unknown Status value "${value}"` });
    }
  }
  for (const value of h1.unknown_module_values) {
    if (!h0.unknown_module_values.includes(value)) {
      events.push({ kind: "notion_health", page_id: null, detail: `unknown Module value "${value}"` });
    }
  }

  return events;
}

/**
 * The idempotency key of a run (hard constraint 3).
 *
 * Two runs in the same hour — a manual dispatch alongside the cron — must
 * produce one digest. Both read the same previous snapshot, so its `taken_at`
 * identifies the pair, and the second run recognises that the digest it is
 * about to publish is one already published against that baseline.
 */
export function idempotencyKey(previous: Snapshot | null): string {
  return previous?.taken_at ?? "genesis";
}
