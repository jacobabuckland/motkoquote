#!/usr/bin/env bash
#
# Compose the DECISION NEEDED section that every blocking comment ends with.
#
#   scripts/factory/decision-section.sh <issue> <stage> <question> <options> <recommendation>
#
# One composer rather than fourteen copies, because the daily digest parses
# this shape. If a call site hand-rolls the section and drifts by a character,
# the digest silently drops that item and the block never reaches a human —
# which is the exact failure this whole layer exists to prevent.
#
# The question must be answerable without reading anything else. "See the QA
# findings above" is not a question; "Should resolvePricingMode throw or return
# null when mode is unset?" is.

set -euo pipefail

ISSUE="${1:-}"
STAGE="${2:-}"
QUESTION="${3:-}"
OPTIONS="${4:-}"
RECOMMENDATION="${5:-}"

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

printf '\n## DECISION NEEDED\n'
printf '**Question:** %s\n' "$QUESTION"
printf '**Options:** %s\n' "$OPTIONS"
printf '**Recommendation:** %s\n' "$RECOMMENDATION"

if [ "$STAGE" = "none" ]; then
  # Nothing to resume: the item is closed, or resuming is not the answer until
  # the human has acted (a spec rewrite, a Notion edit, a decision recorded).
  printf '**To resume:** not resumable as-is — see the question above\n'
else
  printf '**To resume:** ./scripts/factory/resume.sh %s %s\n' "$ISSUE" "$STAGE"
fi
