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
 * FOUR KINDS, in descending strength. `do-not-queue` and `not-factory-ready`
 * both mean never build this here; `dependency` means not yet;
 * `pre-merge-approval` means build it but do not merge without a human.
 *
 * `dependency` closes the LED-5 hole above — the one case listed in this header
 * that nothing matched, because "wait for something else first" is neither a
 * refusal nor an approval gate. It is also the kind most likely to over-fire,
 * since cards describe what they follow all the time, so it requires a
 * directive AND an explicit item reference. "Added after LED-2 shipped" is
 * history, not a dependency.
 *
 * `not-factory-ready` is the explicit opt-out, so a card author does not have
 * to guess which phrasing the matcher knows. One marker, on its own line:
 * `NOT FACTORY READY` or `FACTORY: no`.
 *
 * Pure: a card body in, gates out. No network.
 */

/**
 * @typedef {object} Gate
 * @property {"do-not-queue"|"not-factory-ready"|"dependency"|"pre-merge-approval"} kind
 * @property {string} quote  the sentence that triggered it, for the record
 */

const PATTERNS = [
  {
    kind: "do-not-queue",
    // "Do not queue to the factory" / "do not queue this to the factory"
    re: /do\s+not\s+queue\b[^.\n]*\bfactory\b/i,
  },
  {
    kind: "not-factory-ready",
    // The explicit opt-out, for a card whose author wants it off the pipeline
    // without having to phrase a directive the matcher happens to know. One
    // marker, on its own line, so it cannot be triggered by prose discussing
    // whether something is factory-ready.
    re: /^\s*(?:NOT\s+FACTORY[-\s]?READY|FACTORY:\s*no)\b.*$/im,
  },
  {
    kind: "dependency",
    // "Do NOT start until LED-1 through LED-3 are live". The directive form,
    // which is what LED-5 used and what was admitted anyway.
    re: /do\s+not\s+start\b[^.\n]*\buntil\b[^.\n]*/i,
  },
  {
    kind: "dependency",
    // "Blocked by #306" / "depends on LED-3" / "waits on #308". An explicit
    // item reference is required: without one this fires on any card that
    // mentions depending on something, which is most of them.
    //
    // "after" is deliberately NOT in this list. "Added after LED-2 shipped" is
    // history, not a dependency, and a matcher that cannot tell the two apart
    // stops cards for describing their own past.
    re: /\b(?:blocked\s+by|depends\s+on|waits?\s+on)\b[^.\n]*?(?:#\d+|\b[A-Z]{2,6}-\d+\b)[^.\n]*/i,
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

  // Strongest first: "never build this" outranks "not yet", which outranks
  // "build it but do not merge without me".
  const ORDER = ["do-not-queue", "not-factory-ready", "dependency", "pre-merge-approval"];
  const strongest =
    ORDER.map((kind) => gates.find((g) => g.kind === kind)).find(Boolean) ?? gates[0];

  const REASONS = {
    "do-not-queue": "the card says not to queue this to the factory",
    "not-factory-ready": "the card is marked not factory ready",
    "dependency": "the card says it waits on something that has not landed",
    "pre-merge-approval": "the card requires a human decision before merge",
  };
  const reason = REASONS[strongest.kind] ?? REASONS["pre-merge-approval"];

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
    gates.some((g) => g.kind === "dependency")
      ? "This one waits rather than needing an answer: nothing here is a judgement call, so do not build a placeholder for it and do not ask whether to wait. When the thing it names has landed, release it by applying the stage it should start at — `needs-spec` for a fresh derivation."
      : "Release it by answering the gate and applying the stage it should start at — `needs-spec` for a fresh derivation. If the card means the work should not be built by agents at all, close this and do it by hand.",
    "",
    "_Three cards stated a gate like this in prose and were queued anyway before this check existed: PAY-7 (\"do not queue to the factory\"), LED-5 (\"do NOT start until LED-1 through LED-3 are live\"), and LED-4's legal review of the VAT figure. Green tests cannot tell you which accounting assumption a number encodes._",
  ].join("\n");
}
