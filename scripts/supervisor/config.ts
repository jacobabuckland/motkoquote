/**
 * Every tunable the supervisor has, in one file.
 *
 * The staleness thresholds are here rather than at their call sites because
 * the spec requires them tunable without a code change, and because a
 * threshold buried next to the comparison that uses it is a threshold nobody
 * finds when the factory's timings move. `diff.ts` imports these; it does not
 * define any of its own.
 */

/** Notion databases the snapshot reads. Both, per §5. */
export const ROADMAP_DB_ID =
  process.env.NOTION_DATABASE_ID ?? "3b71e4f9-08b4-8007-8eb9-000b0433c348";
export const BUGS_DB_ID =
  process.env.NOTION_BUGS_DATABASE_ID ?? "3b91e4f9-08b4-80f0-b9fc-ce518dfa63b3";

/**
 * The Notion API version poll-notion.mjs pins. Matched exactly rather than
 * chosen: two clients on different versions against the same database is a
 * class of bug that only shows up on the day Notion changes a default.
 */
export const NOTION_VERSION = "2022-06-28";

export const REPO = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? "jacobabuckland/motkoquote";
export const GITHUB_API = process.env.GITHUB_API_URL ?? "https://api.github.com";

/**
 * Labels that mean "stopped, waiting on a human".
 *
 * Four, matching `factory-decisions-digest.yml` rather than the three in
 * `reconcile-core.ts` — the digest is the surface this one is closest to, and
 * `reconciler-escalated` ("nothing can tell where this item is") is a question
 * for a human by definition. Keeping the lists separate is deliberate: the
 * reconciler's list governs what it will not act on, and this one governs what
 * gets reported. They answer different questions and will diverge again.
 */
export const STOPPED_LABELS = [
  "blocked",
  "qa-disputed",
  "spec-dispute",
  "reconciler-escalated",
] as const;

/**
 * The label the QA agent applies when it rejects an item and sends it back
 * (`factory-qa.yml:543`). Counted from the issue's event history, not from the
 * labels it holds now — a rejection that has since been worked off still
 * happened, and the rate is the metric.
 */
export const QA_REJECTION_LABEL = "qa-changes";

/** Excluded from every count. The tracker must not appear in its own digest. */
export const META_LABEL = "factory-meta";

/**
 * Carried by every bug the supervisor files (T4), alongside `factory-meta`.
 *
 * Two labels rather than one because they do different jobs: `factory-meta`
 * keeps these out of the board's counts, and this one makes them findable
 * again. Deduping on `factory-meta` alone is impossible — that label is the
 * one the board read excludes.
 */
export const SUPERVISOR_LABEL = "supervisor";

/** Notion Status values the factory writes. Anything else is reported unknown. */
export const KNOWN_STATUSES = [
  "Backlog",
  "Ready for factory",
  "In factory",
  "Previewed",
  "Shipped",
  "Blocked",
  "Needs spec",
] as const;
export type TicketStatus = (typeof KNOWN_STATUSES)[number];

/**
 * Module values that are the same value spelled two ways.
 *
 * §5 requires `payment` and `payments` grouped as one and reported as-is, with
 * `unknown_module_values` firing only on a THIRD variant. So the alias map
 * normalises for grouping and the raw string is what gets stored.
 */
export const MODULE_ALIASES: Record<string, string> = {
  payment: "payments",
  payments: "payments",
};

/**
 * Modules the factory uses. Not a gate — an unknown module is reported, never
 * rejected — but a typo'd module silently creates a new bucket that nothing
 * ever looks at, which is the failure this catches.
 */
export const KNOWN_MODULES = [
  "payments",
  "quotes",
  "contracts",
  "invoices",
  "jobs",
  "voice",
  "auth",
  "settings",
  "onboarding",
  "factory",
  "infra",
  "marketing",
  "unassigned",
] as const;

/**
 * Staleness thresholds, in hours. §5's table, verbatim.
 *
 * `readyIdle` is the odd one out: it is a condition on the BOARD rather than on
 * a ticket — something queued with nothing being worked on means the poller is
 * dead — so it is evaluated once per run, not per ticket.
 */
export const THRESHOLDS = {
  "In factory": 4,
  Blocked: 24,
  Previewed: 48,
  "Needs spec": 72,
} as const satisfies Partial<Record<TicketStatus, number>>;

/** Hours a queue may sit with nothing `In factory` before the poller is presumed dead. */
export const FACTORY_IDLE_HOURS = 2;

/** T2: an item `In factory` this long with no commits on its PR is requeued. */
export const REQUEUE_STALE_HOURS = 4;

/** T1: a failed preview is retried at most this often per ticket. */
export const PREVIEW_RETRY_COOLDOWN_HOURS = 24;

/** §8: hard cap on digest lines. "Moved" is what gets truncated, never the rest. */
export const DIGEST_MAX_LINES = 40;

/** Where the snapshot lives. Never on main (D4). */
export const STATE_BRANCH = "factory-state";
export const SNAPSHOT_PATH = "supervisor/snapshot.json";
