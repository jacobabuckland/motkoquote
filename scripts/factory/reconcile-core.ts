/**
 * The reconciler's decision logic.
 *
 * This file contains NO I/O. Everything it decides is a pure function of the
 * state that was actually observed — branch head, CI conclusion for that exact
 * SHA, PR, the latest QA verdict and the SHA it reviewed, and how long the item
 * has held its current stage label. That separation is the point: the factory's
 * standing defect is that state is inferred from whichever event last fired, so
 * the replacement has to be a thing that reads state and can be tested against
 * state, rather than a thing that reacts to a trigger.
 *
 * Nothing here guesses. Where the observed state does not determine an answer,
 * the decision is `escalate` — a reportable state carrying what was read — and
 * never a silent no-op. An item this file cannot classify is an item a human
 * hears about.
 */

export const STAGE_LABELS = [
  "needs-spec",
  "spec-derived",
  "verify",
  "qa-changes",
] as const;
export type Stage = (typeof STAGE_LABELS)[number];

/**
 * Labels that mean "stopped, waiting on a human". All are already in the digest.
 *
 * `spec-dispute` is kept distinct from `qa-disputed` rather than folded into it:
 * "QA read my code wrong" and "the contract I am judged against is wrong" need
 * different answers, and the second has been right every time it has been
 * raised, so it leads the digest instead of queueing behind runner noise.
 */
export const STOPPED_LABELS = ["blocked", "qa-disputed", "spec-dispute"] as const;

/** Labels that mean the pipeline is done with the item. */
export const TERMINAL_LABELS = ["previewed", "shipped"] as const;

/**
 * Which workflow consumes each stage. The reconciler re-fires the CONSUMER,
 * not the label — re-applying a label the issue already holds fires nothing at
 * all, which is the bug, not the fix.
 */
export const STAGE_WORKFLOW: Record<Stage, string> = {
  "needs-spec": "factory-pm.yml",
  "spec-derived": "factory-engineer.yml",
  "qa-changes": "factory-engineer.yml",
  verify: "factory-qa.yml",
};

/**
 * How long an item may hold a stage label with nothing working on it before
 * the reconciler acts. Deliberately a constant rather than a literal at the
 * call site: the right value is not known yet and will be tuned against
 * observed stage durations.
 *
 * 45 minutes sits above the longest legitimate stage this factory runs — the
 * Engineer's job budget is 45 minutes but it holds a RUNNING run for that
 * whole time, and a running run suppresses re-fire on its own (see
 * `hasActiveRun`). This threshold only ever applies to an item with nothing
 * running against it.
 */
export const STALL_THRESHOLD_MINUTES = 45;

/**
 * How many times the reconciler will re-fire the same (stage, head SHA) pair
 * before it stops and asks. A stage that has failed to complete twice with no
 * change in the branch underneath it is not going to complete on the third
 * attempt; continuing to fire it burns agent budget and, worse, looks like
 * progress. Exhaustion is the strongest signal in the system that a human is
 * required, so it escalates as a full DECISION NEEDED rather than a digest line.
 */
export const MAX_AUTO_REFIRES = 2;

export interface CiObservation {
  /** The SHA this conclusion belongs to. Never a branch — the SHA-matching lesson. */
  sha: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  url: string;
}

export interface PrObservation {
  number: number;
  draft: boolean;
  state: string;
  mergeable: boolean | null;
  mergeableState: string | null;
}

export interface QaObservation {
  verdict: "PASS" | "CHANGES";
  /** The SHA QA reviewed, when it could be determined. */
  sha: string | null;
  at: string;
}

export interface LabelEvent {
  name: string;
  at: string;
  action: "labeled" | "unlabeled";
}

export interface ActiveRun {
  workflow: string;
  runId: number;
  status: string;
  url: string;
}

export interface RefireRecord {
  key: string;
  count: number;
  lastAt: string;
}

/**
 * What the branch actually carries, as a three-dot diff against main. Each
 * consumer's own advance condition is stated in these terms — the PM owes a
 * spec and acceptance tests, the Engineer owes an implementation and a green
 * gate — so a stage label can be checked against the artefacts that stage was
 * supposed to produce, rather than against a guess about how far along it is.
 */
export interface BranchContent {
  hasSpec: boolean;
  hasTests: boolean;
  /** Any file in the branch's three-dot diff outside docs/specs and tests/acceptance. */
  hasImplementation: boolean;
}

export interface ObservedItem {
  number: number;
  title: string;
  labels: string[];
  /** null when the branch does not exist. */
  branch: { name: string; sha: string } | null;
  /** null when there is no branch to read. */
  branchContent: BranchContent | null;
  /** CI for the branch head SHA exactly, or null when no run exists for it. */
  ci: CiObservation | null;
  pr: PrObservation | null;
  qa: QaObservation | null;
  /** `labeled`/`unlabeled` events, oldest first. */
  labelEvents: LabelEvent[];
  /** Re-fire ledger carried in the reconciler's own state comment. */
  refires: RefireRecord[];
}

export type Decision =
  | { kind: "skip"; issue: number; reason: string }
  | { kind: "holding"; issue: number; reason: string }
  | { kind: "refire"; issue: number; stage: Stage; workflow: string; key: string; reason: string }
  | {
      kind: "correct-label";
      issue: number;
      add: string[];
      remove: string[];
      reason: string;
    }
  | {
      kind: "escalate";
      issue: number;
      /** null when the item is not resumable at a stage as it stands. */
      resumeStage: Stage | null;
      question: string;
      options: string;
      recommendation: string;
      /**
       * What the reconciler cannot do about this itself.
       *
       * An agent enumerates options inside what it may change, so the correct
       * fix is often structurally invisible to it — and the reconciler's reach
       * is narrower than any agent's: it moves labels and dispatches workflows,
       * and that is all. It cannot push a commit, amend one, delete a branch or
       * edit a spec. An options list should be read as "the best fix I am
       * allowed to make", and this field is where the rest of the space gets
       * named.
       */
      permissions: string;
      reason: string;
    };

/** The stage labels currently on the item, in the order STAGE_LABELS declares. */
export function stageLabelsOn(item: ObservedItem): Stage[] {
  return STAGE_LABELS.filter((s) => item.labels.includes(s));
}

export function isStopped(item: ObservedItem): boolean {
  return STOPPED_LABELS.some((l) => item.labels.includes(l));
}

export function isTerminal(item: ObservedItem): boolean {
  return TERMINAL_LABELS.some((l) => item.labels.includes(l));
}

/** True while any workflow run naming this issue is queued or in progress. */
export function hasActiveRun(item: ObservedItem, runs: ActiveRun[]): boolean {
  return runs.some(
    (r) => r.status === "queued" || r.status === "in_progress" || r.status === "waiting",
  );
}

/**
 * When the item entered its current stage, read from the timeline rather than
 * from `updatedAt`. `updatedAt` moves on every comment, so a stalled item that
 * anything commented on looks fresh — which is how five items stayed invisible
 * to a digest that was explicitly looking for stalls.
 */
export function stageEnteredAt(item: ObservedItem, stage: Stage): string | null {
  const applied = item.labelEvents.filter(
    (e) => e.action === "labeled" && e.name === stage,
  );
  return applied.length > 0 ? applied[applied.length - 1].at : null;
}

/** The most recently applied of a set of labels, by timeline order. */
export function mostRecentlyApplied(
  item: ObservedItem,
  candidates: readonly string[],
): string | null {
  let best: { name: string; at: string } | null = null;
  for (const e of item.labelEvents) {
    if (e.action !== "labeled" || !candidates.includes(e.name)) continue;
    if (best === null || e.at >= best.at) best = { name: e.name, at: e.at };
  }
  return best?.name ?? null;
}

export function minutesBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 60000;
}

export function refireKey(stage: Stage, sha: string | null): string {
  return `${stage}@${sha ?? "no-branch"}`;
}

export function refireCount(item: ObservedItem, key: string): number {
  return item.refires.find((r) => r.key === key)?.count ?? 0;
}

/**
 * A plain-language account of what was actually read, for the escalation
 * comment. The whole value of an escalation is that the human does not have to
 * go and gather this themselves.
 */
export function renderObserved(item: ObservedItem, runs: ActiveRun[], now: string): string {
  const stage = stageLabelsOn(item)[0] ?? null;
  const since = stage ? stageEnteredAt(item, stage) : null;
  const held =
    since !== null ? `${Math.round(minutesBetween(since, now))} min (since ${since})` : "unknown";

  const lines: string[] = [
    "| what was read | value |",
    "| --- | --- |",
    `| labels | ${item.labels.length > 0 ? item.labels.map((l) => `\`${l}\``).join(", ") : "_none_"} |`,
    `| stage held for | ${held} |`,
    `| branch | ${item.branch ? `\`${item.branch.name}\` @ \`${item.branch.sha.slice(0, 8)}\`` : "**does not exist**"} |`,
    `| CI for that SHA | ${
      item.ci === null
        ? "**no run for this SHA**"
        : `${item.ci.status}${item.ci.conclusion ? ` / ${item.ci.conclusion}` : ""} — ${item.ci.url}`
    } |`,
    `| PR | ${
      item.pr === null
        ? "**none**"
        : `#${item.pr.number} (${item.pr.state}${item.pr.draft ? ", draft" : ""}${
            item.pr.mergeableState ? `, ${item.pr.mergeableState}` : ""
          })`
    } |`,
    `| branch carries | ${
      item.branchContent === null
        ? "_no branch to read_"
        : [
            `${item.branchContent.hasSpec ? "spec ✓" : "spec ✗"}`,
            `${item.branchContent.hasTests ? "acceptance tests ✓" : "acceptance tests ✗"}`,
            `${item.branchContent.hasImplementation ? "implementation ✓" : "implementation ✗"}`,
          ].join(", ")
    } |`,
    `| latest QA verdict | ${
      item.qa === null
        ? "_none recorded_"
        : `${item.qa.verdict} at ${item.qa.at}${
            item.qa.sha ? ` on \`${item.qa.sha.slice(0, 8)}\`` : " (SHA not recorded)"
          }`
    } |`,
    `| runs in flight | ${
      runs.length > 0 ? runs.map((r) => `${r.workflow} (${r.status})`).join(", ") : "none"
    } |`,
  ];
  return lines.join("\n");
}

/**
 * Decide what to do about one item.
 *
 * `runs` is the set of workflow runs whose run-name names this issue. Matching
 * on the run name rather than on the head branch is deliberate and load-bearing:
 * a run triggered by `issues.labeled` reports `head_branch: main`, so branch
 * matching would never see ANY label-triggered stage as running — and for the
 * PM stage the branch does not exist at all until it pushes.
 */
export function reconcile(
  item: ObservedItem,
  runs: ActiveRun[],
  now: string,
): Decision {
  if (item.labels.includes("factory-meta")) {
    return { kind: "skip", issue: item.number, reason: "factory-meta bookkeeping issue" };
  }

  const stages = stageLabelsOn(item);
  const stopped = isStopped(item);

  // Two stage labels at once. resume.sh removes the old label and adds the new
  // one in separate API calls, and the gap has produced items carrying both.
  // The timeline says which arrived last, so this is a correction from observed
  // state, not a guess.
  if (stages.length > 1) {
    const keep = mostRecentlyApplied(item, stages);
    if (keep === null) {
      return {
        kind: "escalate",
        issue: item.number,
        resumeStage: null,
        question: `#${item.number} carries ${stages.length} stage labels at once and the timeline does not say which was applied last — which stage is it actually in?`,
        options: `(a) pick the stage from the branch state above and resume there (b) if the branch is empty, resume at \`needs-spec\``,
        recommendation: `Read the branch and CI rows above before choosing. Two stage labels means two consumers can fire on this item, so it is not safe to leave as it is.`,
        permissions: `The reconciler can remove a label but cannot decide which of two contradictory ones is right without timeline evidence, and there is none here.`,
        reason: "multiple stage labels, no timeline evidence",
      };
    }
    return {
      kind: "correct-label",
      issue: item.number,
      add: [],
      remove: stages.filter((s) => s !== keep),
      reason: `carried ${stages.length} stage labels; \`${keep}\` was applied last`,
    };
  }

  // A stage label and a stopped label together. The stopped label means a human
  // was asked a question; the stage label means a consumer owns it. Both cannot
  // be true, and the timeline settles it.
  if (stages.length === 1 && stopped) {
    const contenders = [stages[0], ...STOPPED_LABELS.filter((l) => item.labels.includes(l))];
    const keep = mostRecentlyApplied(item, contenders);
    if (keep !== null) {
      return {
        kind: "correct-label",
        issue: item.number,
        add: [],
        remove: contenders.filter((c) => c !== keep),
        reason: `carried both a stage and a stopped label; \`${keep}\` was applied last`,
      };
    }
  }

  if (stopped) {
    // Already a reported state: the digest collects blocked and qa-disputed.
    return { kind: "skip", issue: item.number, reason: "stopped and already in the digest" };
  }

  if (isTerminal(item)) {
    return { kind: "skip", issue: item.number, reason: "previewed or shipped" };
  }

  // No stage, no stopped state, not terminal. The item is in no stage at all —
  // nothing will ever fire on it again. This is the silent-cessation case the
  // whole reconciler exists for, and it is never a no-op.
  if (stages.length === 0) {
    return {
      kind: "escalate",
      issue: item.number,
      resumeStage: null,
      question: `#${item.number} is an open factory item carrying no stage label and no stopped label — what stage should it re-enter?`,
      options: `(a) resume at the stage the branch state above implies (b) if there is no branch, resume at \`needs-spec\` (c) close it if it is no longer wanted`,
      recommendation: `Nothing can fire on this item as it stands: every consumer is triggered by a stage label and it has none, so it will sit here indefinitely. Choose from the branch, CI and QA rows above rather than from the issue's age.`,
      permissions: `Option (c) is outside the reconciler entirely — it never closes an item. It could apply a stage label, but choosing which one is exactly the judgement this question asks for.`,
      reason: "open factory item in no stage",
    };
  }

  const stage = stages[0];

  // A run naming this issue is queued or in flight. The stage is legitimately
  // working; do nothing at all.
  if (hasActiveRun(item, runs)) {
    return {
      kind: "holding",
      issue: item.number,
      reason: `\`${stage}\` has a run in flight (${runs.map((r) => r.workflow).join(", ")})`,
    };
  }

  // Label corrections that the observed state settles outright. Both are the
  // same shape: QA reached a verdict on the exact SHA the branch still points
  // at, and the label that verdict implies was never applied — the route step
  // died between the review and the label. Gated on SHA equality, so a verdict
  // about an older commit says nothing about this one.
  if (stage === "verify" && item.qa !== null && item.branch !== null && item.qa.sha === item.branch.sha) {
    if (item.qa.verdict === "PASS") {
      return {
        kind: "correct-label",
        issue: item.number,
        add: ["previewed"],
        remove: ["verify"],
        reason: `QA passed \`${item.branch.sha.slice(0, 8)}\`, which is still the branch head, but the item never left \`verify\``,
      };
    }
    return {
      kind: "correct-label",
      issue: item.number,
      add: ["qa-changes"],
      remove: ["verify"],
      reason: `QA returned CHANGES on \`${item.branch.sha.slice(0, 8)}\`, which is still the branch head, but the item never left \`verify\``,
    };
  }

  // A stage that needs a branch, with no branch under it. Re-firing the
  // consumer cannot help: the Engineer and QA both check out factory/N and die
  // immediately if it is missing.
  if (stage !== "needs-spec" && item.branch === null) {
    return {
      kind: "escalate",
      issue: item.number,
      resumeStage: null,
      question: `#${item.number} is at \`${stage}\`, but the branch it names does not exist — was it deleted, or was it never pushed?`,
      options: `(a) the work is gone: resume at \`needs-spec\` to re-derive the item from scratch (b) the branch exists under another name: restore it as \`factory/${item.number}\`, then resume at \`${stage}\``,
      recommendation: `Not resumable at \`${stage}\` as it stands — the Engineer and QA both check out \`factory/${item.number}\` and fail at the checkout, so re-firing reproduces that failure exactly. Check whether a PR for this item still references a head SHA before choosing (a).`,
      permissions: `Both options are human actions. The reconciler moves labels and dispatches workflows; it cannot restore, rename or re-create a branch, and no consumer it can dispatch will run without one.`,
      reason: `stage \`${stage}\` with no branch`,
    };
  }

  const since = stageEnteredAt(item, stage);
  if (since === null) {
    return {
      kind: "escalate",
      issue: item.number,
      resumeStage: stage,
      question: `#${item.number} carries \`${stage}\` but the timeline has no event applying it — how did it get there?`,
      options: `(a) resume at \`${stage}\` to re-fire the consumer (b) read the timeline: a label applied by a since-deleted actor, or an issue transferred between repositories, both look like this`,
      recommendation: `(a) once. Without an application event the reconciler cannot tell how long this has been held, so it cannot decide on its own whether the stage is stalled.`,
      permissions: `unknown`,
      reason: `stage \`${stage}\` with no labelling event`,
    };
  }

  const heldMinutes = minutesBetween(since, now);
  if (heldMinutes < STALL_THRESHOLD_MINUTES) {
    return {
      kind: "holding",
      issue: item.number,
      reason: `\`${stage}\` held ${Math.round(heldMinutes)} min, under the ${STALL_THRESHOLD_MINUTES} min threshold`,
    };
  }

  // Past the threshold with nothing running. Before re-firing the stage, check
  // whether the stage has ALREADY done its job — an item whose consumer
  // finished and then failed to move the label is not stalled, it is finished
  // and mislabelled, and re-firing it is the documented trap: the Engineer run
  // on completed work finds nothing to do and blocks the item.
  //
  // Every rule below is the consumer's own advance condition, read off the
  // branch. Nothing here judges whether an implementation is GOOD; that is
  // QA's job and this only decides who should be looking at it.
  const content = item.branchContent;
  if (content !== null && item.branch !== null) {
    // The SHA is checked here rather than trusted from the caller. The observer
    // only ever fetches CI for the branch head, but a rule that depends on that
    // being true and does not say so is one refactor away from advancing an
    // item on a green run belonging to an earlier commit — which is the exact
    // failure the Engineer's gate was rewritten to close.
    const ciGreen =
      item.ci !== null &&
      item.ci.sha === item.branch.sha &&
      item.ci.status === "completed" &&
      item.ci.conclusion === "success";

    if (stage === "needs-spec") {
      if (!content.hasSpec || !content.hasTests) {
        return {
          kind: "escalate",
          issue: item.number,
          resumeStage: null,
          question: `#${item.number} is at \`needs-spec\` but \`factory/${item.number}\` already exists and is missing ${!content.hasSpec ? "a spec" : "acceptance tests"} — should the branch be discarded and re-derived?`,
          options: `(a) discard the branch and re-derive: delete \`factory/${item.number}\`, then resume at \`needs-spec\` (b) the branch is worth keeping: add the missing artefact to its FIRST commit by hand, then resume at \`spec-derived\``,
          recommendation: `Not re-fired automatically. The PM cuts \`factory/${item.number}\` fresh, so running it over a branch that already exists produces a divergent push rather than a clean re-derivation — which is a worse state than this one.`,
          permissions: `The reconciler cannot delete a branch or amend a commit, so neither option is available to it — and it will not dispatch the PM here, because the PM cuts the branch fresh and would push over what is already there.`,
          reason: `\`needs-spec\` over an existing branch missing ${!content.hasSpec ? "a spec" : "tests"}`,
        };
      }
      if (!content.hasImplementation) {
        return {
          kind: "correct-label",
          issue: item.number,
          add: ["spec-derived"],
          remove: ["needs-spec"],
          reason: `the branch carries a spec and acceptance tests, so the PM stage finished; the label never moved`,
        };
      }
      if (ciGreen) {
        return {
          kind: "correct-label",
          issue: item.number,
          add: ["verify"],
          remove: ["needs-spec"],
          reason: `the branch carries a spec, acceptance tests and an implementation, and CI is green on \`${item.branch.sha.slice(0, 8)}\` — both the PM and the Engineer finished and neither label moved`,
        };
      }
      return {
        kind: "escalate",
        issue: item.number,
        resumeStage: null,
        question: `#${item.number} says \`needs-spec\`, but its branch carries a spec, acceptance tests AND an implementation — which stage is it really in?`,
        options: `(a) the implementation is complete: \`ANSWER: verify\` to send it to QA (b) the implementation is partial: \`ANSWER: spec-derived\` to have the Engineer finish it (c) re-derive from scratch: delete the branch, then \`ANSWER: needs-spec\``,
        recommendation: `CI is ${item.ci === null ? "absent for the branch head" : `\`${item.ci.conclusion ?? item.ci.status}\``}, so the Engineer's own advance condition — pushed and green — is not met and this cannot be advanced on evidence. Read the gate before choosing; the label has been wrong since the PM finished, so its age says nothing about how complete the work is.`,
        permissions: `The reconciler will advance this by itself the moment the gate is green on the branch head, which is evidence it can read. Judging whether a partial implementation is finished is not.`,
        reason: `\`needs-spec\` over a branch that already carries an implementation`,
      };
    }

    if (stage === "spec-derived" && content.hasImplementation && ciGreen) {
      return {
        kind: "correct-label",
        issue: item.number,
        add: ["verify"],
        remove: ["spec-derived"],
        reason: `the branch carries an implementation and CI is green on \`${item.branch.sha.slice(0, 8)}\`, which is the Engineer's own condition for handing over to QA`,
      };
    }
  }

  const key = refireKey(stage, item.branch?.sha ?? null);
  const fired = refireCount(item, key);

  if (fired < MAX_AUTO_REFIRES) {
    return {
      kind: "refire",
      issue: item.number,
      stage,
      workflow: STAGE_WORKFLOW[stage],
      key,
      reason: `\`${stage}\` held ${Math.round(heldMinutes)} min with nothing running; re-fire ${fired + 1} of ${MAX_AUTO_REFIRES}`,
    };
  }

  return {
    kind: "escalate",
    issue: item.number,
    resumeStage: stage,
    question: `#${item.number} has been re-fired at \`${stage}\` ${fired} times against the same commit and has not moved — is the item stuck, or is the stage's consumer broken?`,
    options: `(a) read the linked runs above and fix what they name, then resume at \`${stage}\` (b) the item cannot complete as specified: send it back with \`ANSWER: needs-spec\` to re-derive it (c) the work is actually finished: \`ANSWER: verify\` to have QA judge it`,
    recommendation: `The reconciler has exhausted its automatic re-fires, which means every one of them started and none produced a state change. That is evidence about the consumer or the item, not about timing, so a further re-fire is not the answer — nothing about the branch has changed between attempts.`,
    permissions: `The reconciler has one lever — dispatch the stage again — and it has now pulled it to no effect every time it was allowed to. Everything remaining is outside it: it cannot push, amend, or edit a spec.`,
    reason: `re-fires exhausted at \`${stage}\` (${fired}/${MAX_AUTO_REFIRES})`,
  };
}
