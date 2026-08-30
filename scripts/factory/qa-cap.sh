#!/usr/bin/env bash
#
# Decide whether the QA↔Engineer loop should stop, and whether a finished item
# can leave without another agent run.
#
#   scripts/factory/qa-cap.sh <timeline.json> <comments.json> <head-sha> <ci-conclusion>
#
# Pure: it reads two JSON files and prints KEY=value lines. No network, so the
# rules below are exercised directly by tests instead of being inferred from a
# workflow that only runs in anger.
#
# WHAT CHANGED AND WHY
#
# The cap used to count ROUNDS. Three qa-changes labels and the item stopped,
# regardless of what happened inside them — so a cycle in which the Engineer
# complied fully and QA then raised something entirely new counted against the
# item exactly as a cycle in which nothing moved. Four items stopped that way in
# a single afternoon (#96, #185, #195, #123), every one of them AFTER the
# Engineer had already complied. Compliance was being counted as failure.
#
# THE CATCH-ALL KEY. #273: the cap stopped #258 saying
# `incomplete-implementation` "has been raised 5 times without being resolved",
# and told the reader "it is this one criterion that keeps coming back". It was
# not one criterion. Cycle 4 was a missing "Edit" button required by spec
# section 3, fixed in 13d75e2. Cycle 5 was `amount_pence` authored as a required
# tool parameter, violating the money-integrity rule, fixed in 32b8180.
# Different requirements, different fixes, each resolved on the cycle it was
# raised — collapsed into one because they shared a category word.
#
# There is no way to separate them from what QA emitted. Both findings cite the
# same file, so keying on category-plus-path does not part them, and matching
# the prose is a heuristic that fails in both directions. The identity simply is
# not in the data.
#
# So the cap does not guess. A key on the catch-all list below cannot identify a
# criterion, and a criterion count computed from it is not a criterion count —
# so those keys are counted per cycle and never across cycles. An item keyed
# entirely in catch-alls therefore stops at HARD_CYCLE_CEILING rather than at
# MAX_DISAGREEMENTS.
#
# That is a deliberate trade in the direction of stopping later. It is the right
# way round here: the observed failure was a FALSE stop on an item that was
# converging, which costs a human intervention, and the fallback is a real stop
# that still happens, five cycles later. The prompt in factory-qa.yml names
# these keys as forbidden for the same reason, so QA's incentive and the cap's
# arithmetic agree rather than pulling against each other.
#
# It now counts UNRESOLVED DISAGREEMENTS ABOUT THE SAME CRITERION. A criterion
# QA raises, the Engineer addresses, and QA does not raise again is resolved —
# that is progress and it costs nothing. A criterion QA keeps re-raising across
# cycles is the actual signal the cap exists to catch: three cycles arguing
# about the same requirement is evidence about the contract, not the code.
#
# The anchor moved too. It was the last `spec-derived` label, which made
# `spec-derived` reset the counter — and that created a loop with no exit:
# resuming a finished item at `spec-derived` re-runs the Engineer, which
# correctly finds nothing to do, which the push step reads as a malfunction and
# blocks. The anchor is now `needs-spec`, which is the only label that really
# does start the item over.
set -euo pipefail

TIMELINE="${1:-}"
COMMENTS="${2:-}"
HEAD_SHA="${3:-}"
CI_CONCLUSION="${4:-none}"

[ -f "$TIMELINE" ] || { echo "qa-cap: timeline file '$TIMELINE' not found" >&2; exit 2; }
[ -f "$COMMENTS" ] || { echo "qa-cap: comments file '$COMMENTS' not found" >&2; exit 2; }

# How many times one criterion may be re-raised, unresolved, before the loop
# stops. Three is the same number the round-based cap used, deliberately: the
# change here is WHAT is counted, not how much of it is tolerated.
MAX_DISAGREEMENTS="${MAX_DISAGREEMENTS:-3}"

# An absolute ceiling, because counting per-criterion means an item that raises
# a brand new finding every cycle would otherwise never stop. Set well above any
# healthy item so it only catches a genuine runaway.
HARD_CYCLE_CEILING="${HARD_CYCLE_CEILING:-8}"

# Keys too coarse to name a criterion. Exact matches only — `spec-file-mismatch`
# is a good key and must not be caught by a substring rule against
# `spec-mismatch`. Adding to this list widens what the cap declines to count, so
# it is a reviewed change: the bar is that no two unrelated findings could ever
# share the key legitimately.
CATCHALL_KEYS="${CATCHALL_KEYS:-incomplete-implementation incomplete missing missing-implementation not-implemented bug bugs broken incorrect error errors issue issues problem problems quality correctness spec-fidelity spec-violation}"

RESULT=$(jq -n \
  --slurpfile timeline "$TIMELINE" \
  --slurpfile comments "$COMMENTS" \
  --arg catchall "$CATCHALL_KEYS" '
  ($catchall | split(" ") | map(select(length > 0))) as $generic
  # $i is the cycle index. A catch-all key is suffixed with it, so the key is
  # still counted once within its own cycle and can never match the same word in
  # another — which is exactly the claim the cap is unable to make about it.
  | def findings($body; $i):
    [ $body | split("\n")[]
      | select(test("^FINDING:[[:space:]]*[a-z0-9]"))
      | sub("^FINDING:[[:space:]]*"; "")
      | split(" ")[0]
      | ascii_downcase
      | if (. as $k | $generic | index($k)) then "\(.)#\($i)" else . end ];

  ($timeline[0] // []) as $tl
  | ($comments[0] // []) as $cm
  # Anchored to needs-spec, the only label that genuinely restarts the item.
  # Empty anchor means "count everything", which fails closed toward the cap.
  | ([ $tl[] | select(.event == "labeled" and .label.name == "needs-spec") ] | last | .created_at // "") as $anchor
  | [ $cm[]
      | select($anchor == "" or .created_at > $anchor)
      | select(.body | startswith("**QA findings**")) ] as $cycles
  # A cycle whose comment carries no FINDING: keys contributes one synthetic
  # key, so comments written before keys existed still count as rounds rather
  # than vanishing from the tally and making the cap unreachable.
  | ($cycles | to_entries
     | map(findings(.value.body; .key)
           | if length == 0 then ["unkeyed"] else . end)) as $keysets
  | ($keysets | last // []) as $latest
  # The key is bound explicitly. Written as `select(index(.))` the inner `.` is
  # the keyset being tested, not the key being counted, so every criterion
  # scored the same and the cap tripped on round three regardless.
  | ($latest
     | map(. as $k | { ($k): ([ $keysets[] | select(index($k)) ] | length) })
     | add // {}) as $repeats
  | ($repeats | to_entries | max_by(.value) // { key: "", value: 0 }) as $worst
  | [ $cm[] | select(.body | test("<!--[[:space:]]*qa-verdict")) ] as $stamped
  | ($stamped | last) as $lastStamped
  | {
      cycles: ($cycles | length),
      anchor: $anchor,
      worst_criterion: ($worst.key | sub("#[0-9]+$"; "")),
      worst_count: $worst.value,
      latest_verdict: (
        if $lastStamped == null then "none"
        else ($lastStamped.body | capture("qa-verdict verdict=(?<v>PASS|CHANGES)").v)
        end),
      latest_verdict_sha: (
        if $lastStamped == null then ""
        else ($lastStamped.body | capture("sha=(?<s>[0-9a-f]{7,40})").s)
        end),
    }')

CYCLES=$(printf '%s' "$RESULT" | jq -r '.cycles')
WORST=$(printf '%s' "$RESULT" | jq -r '.worst_criterion')
WORST_COUNT=$(printf '%s' "$RESULT" | jq -r '.worst_count')
LATEST_VERDICT=$(printf '%s' "$RESULT" | jq -r '.latest_verdict')
LATEST_SHA=$(printf '%s' "$RESULT" | jq -r '.latest_verdict_sha')

# Has a person answered the cap's own question since it last stopped the item?
#
# THE SECOND TRAP. The cap offers "QA was wrong — ANSWER: verify to have it look
# again" as a route out, and that route did not work: the check runs at the top
# of the verify stage, so resuming there re-fired the cap before any reviewer
# looked, and the item blocked again within a minute. LED-5 went round that loop
# on 18 Aug with the fix already pushed.
#
# A person answering the DECISION NEEDED is not another agent argument. It is
# the human judgement the cap exists to summon, and it buys exactly one review —
# not a reset. The counter stays where it is, so if QA raises the same criterion
# again on the corrected head, the item stops again and rightly so.
ANSWERED=$(jq -r '
  [ .[] | .body // "" ] as $bodies
  | ( $bodies | to_entries | map(select(.value | startswith("**Stopped:")))
      | if length == 0 then null else (last | .key) end ) as $stopped
  | ( $bodies | to_entries | map(select(.value | test("Resumed at `verify`")))
      | if length == 0 then null else (last | .key) end ) as $resumed
  | ( $bodies | to_entries | map(select(.value | test("qa-verdict verdict=")))
      | if length == 0 then null else (last | .key) end ) as $reviewed
  | if $stopped == null or $resumed == null then "false"
    elif $resumed < $stopped then "false"
    # Spent. A review has already happened since the answer, so the one look it
    # bought has been taken. Without this the flag stays true forever, because
    # `proceed` posts no new stop comment for a later resume to be newer than —
    # and "exactly one review" would be a comment describing behaviour the code
    # did not have.
    elif $reviewed != null and $reviewed > $resumed then "false"
    else "true" end
' "$COMMENTS")

REASON=""
if [ "$WORST_COUNT" -ge "$MAX_DISAGREEMENTS" ]; then
  CAPPED=true
  REASON="criterion"
elif [ "$CYCLES" -ge "$HARD_CYCLE_CEILING" ]; then
  CAPPED=true
  REASON="runaway"
else
  CAPPED=false
fi

# THE EXIT. A finished item must never need another cycle to escape a counter.
#
# QA has already passed the exact commit the branch points at, and the gate is
# green on that same commit: there is nothing left for an agent to decide, so
# the item advances with no further run — capped or not. Gated on SHA equality
# in both directions, because a pass about an earlier commit says nothing about
# this one, and that is the whole way a cap becomes a trap: the item is
# finished, the counter is spent, and the only route out runs an agent that
# finds nothing to do and blocks it again.
DECISION="proceed"
if [ "$LATEST_VERDICT" = "PASS" ] \
   && [ -n "$LATEST_SHA" ] \
   && [ -n "$HEAD_SHA" ] \
   && [ "$LATEST_SHA" = "$HEAD_SHA" ] \
   && [ "$CI_CONCLUSION" = "success" ]; then
  DECISION="exit-previewed"
elif [ "$CAPPED" = "true" ] && [ "$ANSWERED" = "true" ] && [ "$REASON" = "criterion" ]; then
  # A person read the DECISION NEEDED and said to review again. Grant exactly
  # one review — the flag goes false as soon as a verdict follows the answer.
  # CAPPED stays true and the counter is untouched, so this buys a look rather
  # than three more arguments, and the same criterion on the corrected head
  # stops the item again.
  #
  # Only for REASON=criterion. The runaway ceiling is the absolute backstop
  # against an item that raises a brand new finding every cycle forever, and a
  # single human answer must not be able to switch that off — an escape from one
  # guard should never become an escape from all of them.
  DECISION="proceed"
elif [ "$CAPPED" = "true" ]; then
  DECISION="cap"
fi

echo "decision=$DECISION"
echo "capped=$CAPPED"
echo "human_answered=$ANSWERED"
echo "cap_reason=$REASON"
echo "cycles=$CYCLES"
echo "worst_criterion=$WORST"
echo "worst_count=$WORST_COUNT"
echo "latest_verdict=$LATEST_VERDICT"
echo "latest_verdict_sha=$LATEST_SHA"
echo "max_disagreements=$MAX_DISAGREEMENTS"
