import type { NextMove, Stage, StageKey, StageState } from "@/lib/job-stages";

/**
 * The job timeline as a contractor reads it: five rows, not six stages.
 *
 * WHY THIS IS A PRESENTATION MAPPING AND NOT A CHANGE TO THE STATE MACHINE.
 * `job-stages.ts` derives six keys — quote_sent, accepted, contract_signed,
 * work_complete, invoiced, paid — and eleven frozen acceptance tests depend on
 * them (419 and 546 most heavily). Those keys are also the right resolution
 * for the machine: "accepted but not signed" is a real state the product has
 * to reason about.
 *
 * It is not a useful row on a timeline. A quote is accepted and signed in one
 * motion from the customer's side, and "work complete" is not a thing the
 * contractor tells anyone — they raise an invoice. So the machine keeps its
 * resolution and the timeline shows the five moments a job actually has:
 *
 *     Job captured → Quote sent → Accepted & signed → Invoiced → Paid
 *
 * The chip and the timeline still come from the single `deriveSituation` call,
 * which is the invariant that matters — this collapses that one answer for
 * reading, it does not compute a second one.
 */
export type TimelineRow = {
  key: string;
  label: string;
  state: StageState;
  /** A date for a step that happened, or null. */
  date: string | null;
  /**
   * What the CURRENT row says on its right-hand side: the actual requirement
   * ("Your move", "With Megan", "Due now") rather than a date it does not yet
   * have. Null on every other row.
   */
  requirement: string | null;
};

/**
 * Merge two stages into one row.
 *
 * Order of precedence is deliberate. `declined` wins outright — a pipeline
 * that stopped must show where. `current` beats `complete` so a half-done pair
 * reads as the thing still being waited on rather than as finished. `forced`
 * survives only when nothing else claims the row, because it means "marked
 * complete for monotonicity", which is weaker than either.
 */
const mergeStates = (a: StageState, b: StageState): StageState => {
  if (a === "declined" || b === "declined") return "declined";
  if (a === "current" || b === "current") return "current";
  if (a === "complete" && b === "complete") return "complete";
  if (a === "forced" || b === "forced") return "forced";
  if (a === "complete" || b === "complete") return "current";
  return "future";
};

/** The earlier of two dates, ignoring nulls — when a pair merges, the row
 *  carries the moment the pair STARTED, which is what a reader is looking for. */
const earlier = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
};

/**
 * What the current row asks for, in the words the contractor needs.
 *
 * `overdue` is checked first because it outranks whose move it is: a payment
 * that is late is late whoever is holding it.
 */
const requirementFor = (
  move: NextMove,
  customerFirstName: string,
  overdue: boolean,
): string => {
  if (overdue) return "Due now";
  if (move === "contractor") return "Your move";
  if (move === "customer") return `With ${customerFirstName}`;
  return "";
};

export const buildJobTimeline = ({
  stages,
  move,
  customerFirstName,
  capturedAt,
  overdue = false,
}: {
  stages: Stage[];
  move: NextMove;
  customerFirstName: string;
  /** When the job itself was captured — the one row with no stage behind it. */
  capturedAt: string | null;
  overdue?: boolean;
}): TimelineRow[] => {
  const byKey = (key: StageKey): Stage | undefined =>
    stages.find((stage) => stage.key === key);

  const stageState = (key: StageKey): StageState => byKey(key)?.state ?? "future";
  const stageDate = (key: StageKey): string | null => byKey(key)?.date ?? null;

  // Job captured has no stage behind it: if there is a job to look at, it was
  // captured. It is the row that makes the timeline start where the contractor
  // thinks the job started, rather than at the first thing the system stored.
  const rows: TimelineRow[] = [
    {
      key: "captured",
      label: "Job captured",
      state: "complete",
      date: capturedAt,
      requirement: null,
    },
    {
      key: "quote_sent",
      label: "Quote sent",
      state: stageState("quote_sent"),
      date: stageDate("quote_sent"),
      requirement: null,
    },
    {
      key: "accepted_signed",
      label: "Accepted & signed",
      state: mergeStates(stageState("accepted"), stageState("contract_signed")),
      date: earlier(stageDate("accepted"), stageDate("contract_signed")),
      requirement: null,
    },
    {
      key: "invoiced",
      label: "Invoiced",
      // Follows `invoiced` ALONE — `work_complete` is dropped, not merged.
      //
      // Merging it symmetrically was wrong and the tests caught it: marking
      // work complete is optional, and most contractors go straight to
      // invoicing. So "work_complete future, invoiced complete" is an ordinary
      // finished job, and a symmetric merge read it as half-done — which made
      // this row claim the "current" marker and the requirement text away from
      // the row that was genuinely open.
      //
      // Accepted & signed keeps its merge because BOTH halves are really
      // required there: a quote accepted without a signed contract is a job
      // still waiting on the customer, and the merged row should say so.
      state: stageState("invoiced"),
      date: stageDate("invoiced"),
      requirement: null,
    },
    {
      key: "paid",
      label: "Paid",
      state: stageState("paid"),
      date: stageDate("paid"),
      requirement: null,
    },
  ];

  // Exactly one row carries the requirement, and only while something is
  // pending. A settled job asks for nothing.
  const currentIndex = rows.findIndex((row) => row.state === "current");
  if (currentIndex !== -1) {
    const text = requirementFor(move, customerFirstName, overdue);
    if (text) rows[currentIndex] = { ...rows[currentIndex], requirement: text };
  }

  return rows;
};
