#!/usr/bin/env bash
#
# Compose the DECISION NEEDED section that every blocking comment ends with.
#
#   scripts/factory/decision-section.sh <issue> <stage> <question> <options> \
#                                       <recommendation> <permissions>
#
# One composer rather than fourteen copies, because the daily digest parses
# this shape. If a call site hand-rolls the section and drifts by a character,
# the digest silently drops that item and the block never reaches a human —
# which is the exact failure this whole layer exists to prevent.
#
# The question must be answerable without reading anything else. "See the QA
# findings above" is not a question; "Should resolvePricingMode throw or return
# null when mode is unset?" is.
#
# THE SIXTH FIELD. An agent enumerates the options inside what it is allowed to
# edit, so the correct fix — in a frozen file, behind a token scope it lacks, in
# a Notion card it cannot see — is structurally invisible to it and never
# appears in the list. An option list should be read as "the best fix I am
# allowed to make", and the human needs to be told what the rest of the space
# looks like. Two sentinels are accepted:
#
#   none     nothing outside the agent's reach was identified
#   unknown  not assessed — say so rather than implying nothing exists
#
# Anything else is rendered verbatim, and should name the specific boundary:
# "the fix is in tests/acceptance/171.test.ts, which the Engineer may not edit".

set -euo pipefail

ISSUE="${1:-}"
STAGE="${2:-}"
QUESTION="${3:-}"
OPTIONS="${4:-}"
RECOMMENDATION="${5:-}"
PERMISSIONS="${6:-}"

die() { echo "decision-section: $1" >&2; exit 2; }

case "$ISSUE" in
  ''|*[!0-9]*) die "issue must be a number, got '${ISSUE}'" ;;
esac

case "$STAGE" in
  needs-spec|spec-derived|verify|qa-changes|none) ;;
  *) die "unknown stage '${STAGE}' (needs-spec|spec-derived|verify|qa-changes|none)" ;;
esac

# Empty fields are refused rather than rendered blank. A section with no
# question is indistinguishable from no section at all to the person reading
# it, and worse, it looks like the layer is working.
[ -n "$QUESTION" ]       || die "question is empty"
[ -n "$OPTIONS" ]        || die "options are empty"
[ -n "$RECOMMENDATION" ] || die "recommendation is empty"

# Required rather than optional, and deliberately so: an optional field is one
# every call site omits, and the whole point is that each blocking path has to
# stop and consider what it cannot reach. `unknown` is a legitimate answer;
# silence is not.
[ -n "$PERMISSIONS" ] || die "permissions is empty — pass 'none' or 'unknown' if there is nothing specific to say"

case "$PERMISSIONS" in
  none)
    PERMISSIONS_TEXT="none identified — every option above is one the agent could have taken itself." ;;
  unknown)
    PERMISSIONS_TEXT="not assessed. The options above are the fixes available inside what the agent may edit; a fix requiring a frozen file, a wider token scope or a change to the roadmap item would not appear there." ;;
  *)
    PERMISSIONS_TEXT="$PERMISSIONS" ;;
esac

printf '\n## DECISION NEEDED\n'
printf '**Question:** %s\n' "$QUESTION"
printf '**Options:** %s\n' "$OPTIONS"
printf '**Recommendation:** %s\n' "$RECOMMENDATION"
printf '**Fixes outside my permissions:** %s\n' "$PERMISSIONS_TEXT"

if [ "$STAGE" = "none" ]; then
  # Nothing to resume: the item is closed, or resuming is not the answer until
  # the human has acted (a spec rewrite, a Notion edit, a decision recorded).
  printf '**To resume:** not resumable as-is — see the question above\n'
else
  printf '**To resume:** ./scripts/factory/resume.sh %s %s\n' "$ISSUE" "$STAGE"
fi
