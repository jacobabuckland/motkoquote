#!/usr/bin/env bash
#
# Compose the evidence block that every blocking comment about a failed run
# carries, from the run itself.
#
#   scripts/factory/failure-evidence.sh <run-id> [tail-lines]
#
# WHY THIS EXISTS. Blocking reports used to infer a cause from the name of the
# step that failed — a `case` over step names, each arm carrying a confident
# diagnosis and a recommendation to match. Of five blocking recommendations
# checked in the 16-17 August field review, four rested on a premise that was
# false by the time anyone read them, and following them would have burned
# Engineer runs on items that were already past the problem. A recommendation
# derived from a step name is a guess wearing the clothes of a finding.
#
# The pipeline already fetches the failing job. This prints what it says, so a
# blocking comment can quote its evidence instead of inferring from a label.
# Where the log cannot be obtained, that is stated plainly — an absent log is
# itself a fact about the run, and is far more useful than a plausible story.
#
# It always exits 0 and always prints something. A blocking path that dies
# while composing its explanation produces a silent block, which is the one
# outcome the whole layer exists to prevent.

set -uo pipefail

RUN_ID="${1:-}"
TAIL_LINES="${2:-20}"

if [ -z "$RUN_ID" ]; then
  printf '**Evidence:** none — no run id was passed to the evidence composer. That is a factory fault: this block should never be empty.\n'
  exit 0
fi

printf '### What the run actually says\n\n'

JOBS_JSON=""
if ! JOBS_JSON=$(gh run view "$RUN_ID" --json jobs 2>/dev/null); then
  JOBS_JSON=""
fi

if [ -n "$JOBS_JSON" ]; then
  FAILED_JOBS=$(printf '%s' "$JOBS_JSON" | jq -r '
    [.jobs[] | select(.conclusion != null and .conclusion != "success" and .conclusion != "skipped")
     | "- **\(.name)** (\(.conclusion)) — \(.url)"] | join("\n")' 2>/dev/null || true)
  FAILED_STEPS=$(printf '%s' "$JOBS_JSON" | jq -r '
    [.jobs[].steps[]? | select(.conclusion == "failure") | "`\(.name)`"] | unique | join(", ")' 2>/dev/null || true)

  if [ -n "$FAILED_JOBS" ]; then
    printf 'Failing job(s):\n\n%s\n\n' "$FAILED_JOBS"
  else
    printf 'No job in this run reports a non-success conclusion. The run failed without a failing job, which usually means it was cancelled or the runner died.\n\n'
  fi

  if [ -n "$FAILED_STEPS" ] && [ "$FAILED_STEPS" != "" ]; then
    printf 'Failing step(s): %s\n\n' "$FAILED_STEPS"
  else
    printf 'Failing step(s): could not be determined from the jobs API.\n\n'
  fi
else
  printf 'The jobs for this run could not be read, so neither the failing job nor the failing step is known here. Run: %s\n\n' "$RUN_ID"
fi

LOG=$(mktemp)
if gh run view "$RUN_ID" --log-failed > "$LOG" 2>/dev/null && [ -s "$LOG" ]; then
  printf 'Last %s lines of the failing log:\n\n' "$TAIL_LINES"
  printf '```\n'
  # Timestamps and the job/step prefix GitHub prepends are stripped so the
  # error itself is legible in a comment rather than lost at the right margin.
  tail -n "$TAIL_LINES" "$LOG" | sed -E 's/^[^\t]*\t[^\t]*\t//; s/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z //' | cut -c1-300
  printf '```\n\n'
else
  printf 'The failing log could not be retrieved for this run. That is a fact about the run, not a description of the failure — do not read it as "no output". Open it directly before deciding anything.\n\n'
fi
rm -f "$LOG"
