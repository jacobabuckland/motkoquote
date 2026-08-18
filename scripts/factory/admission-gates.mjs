/**
 * Human gates that roadmap cards state in prose, made machine-readable.
 *
 * WHY. Three cards in a row told the factory to stop, in plain English, and the
 * factory read none of them:
 *
 *   PAY-7  "Do not queue to the factory. This is a judgment call ... and it
 *           needs a number in front of it, not an agent."   -> queued, built,
 *                                                              previewed
 *   LED-5  "Do NOT start until LED-1 through LED-3 are live" -> admitted, built
 *   LED-4  "Before merge, Jacob confirms the wording with legal review"
 *
 * LED-4 is the one that matters most: its VAT figure changes meaning under the
 * flat-rate scheme, cash versus accrual accounting, and CIS reverse charge, and
 * its own card says to ship without the panel rather than with a wrong one.
 * Nothing in the pipeline could enforce that, so it would have shipped on the
 * strength of green tests — tests that cannot know which accounting assumption
 * a number encodes.
 *
 * The poller is where this belongs. It is the one place a card's prose is read
 * at all, and admission is the last moment before agent effort is spent.
 *
 * Deliberately narrow. It matches directive phrasings, not any mention of
 * "legal" or "review", because a gate that fires on discussion of a topic
 * would stop every card that mentions VAT and be switched off within a week.
 *
 * Pure: a card body in, gates out. No network.
 */

/**
 * @typedef {object} Gate
 * @property {"do-not-queue"|"pre-merge-approval"} kind
 * @property {string} quote  the sentence that triggered it, for the record
 */

const PATTERNS = [
  {
    kind: "do-not-queue",
    // "Do not queue to the factory" / "do not queue this to the factory"
    re: /do\s+not\s+queue\b[^.\n]*\bfactory\b/i,
  },
  {
    kind: "pre-merge-approval",
    // "Before merge, X confirms ..." / "before merging, ... sign-off"
    re: /before\s+merg\w*[^.\n]*\b(confirm\w*|sign[-\s]?off|approv\w*|review\w*)\b/i,
  },
  {
    kind: "pre-merge-approval",
    // An explicit gate heading, e.g. "## LEGAL / ACCURACY GATE"
    re: /^#{1,6}\s*[^\n]*\bGATE\b[^\n]*$/im,
  },
];

/**
 * Every human gate a card states. Order follows PATTERNS so the strongest
 * (refuse to start at all) is reported first.
 */
export function detectHumanGates(body) {
  const text = String(body ?? "");
  const found = [];
  for (const { kind, re } of PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    if (found.some((g) => g.kind === kind)) continue;
    found.push({ kind, quote: match[0].trim().slice(0, 300) });
  }
  return found;
}

/**
 * What the poller should do with a card carrying these gates.
 *
 * Always "admit-stopped" rather than "refuse": an item that is never created is
 * invisible, and invisible is how PAY-7 stayed queued for a day. Creating it
 * with no stage label means no agent runs, the decisions digest lists it, and a
 * person can release it — which is the outcome every one of these cards asked
 * for and none of them got.
 */
export function admissionVerdict(gates) {
  if (gates.length === 0) return { admit: true, stopped: false, reason: null };

  const strongest = gates.find((g) => g.kind === "do-not-queue") ?? gates[0];
  const reason =
    strongest.kind === "do-not-queue"
      ? "the card says not to queue this to the factory"
      : "the card requires a human decision before merge";

  return { admit: true, stopped: true, reason, gates };
}

/** The comment left on the item, so the directive is on the issue itself. */
export function renderGateNotice(gates, reason) {
  return [
    `**Stopped at admission — ${reason}.**`,
    "",
    "The roadmap card states a gate that no stage in the pipeline can satisfy, so this item was created without a stage label and no agent has run on it. Nothing has been built and no effort has been spent.",
    "",
    ...gates.map((g) => `> ${g.quote.replace(/\n/g, " ")}`),
    "",
    "Release it by answering the gate and applying the stage it should start at — `needs-spec` for a fresh derivation. If the card means the work should not be built by agents at all, close this and do it by hand.",
    "",
    "_Three cards stated a gate like this in prose and were queued anyway before this check existed: PAY-7 (\"do not queue to the factory\"), LED-5 (\"do NOT start until LED-1 through LED-3 are live\"), and LED-4's legal review of the VAT figure. Green tests cannot tell you which accounting assumption a number encodes._",
  ].join("\n");
}
