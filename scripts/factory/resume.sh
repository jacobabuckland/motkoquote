#!/usr/bin/env bash
#
# Resume a blocked factory item at a chosen stage.
#
#   scripts/factory/resume.sh <issue> <stage>
#
# Stages, and how to pick one — getting this wrong is the most common way to
# waste a cycle:
#
#   needs-spec    No branch, or no spec and tests. The PM runs from scratch.
#   spec-derived  Spec and tests exist; the implementation is missing, broken,
#                 or incomplete. The Engineer runs.
#   verify        The implementation is complete and its tests pass. QA runs.
#   qa-changes    QA raised findings and the Engineer should address them.
#
# The trap: `spec-derived` on an item whose implementation is already finished
# re-runs the Engineer, which correctly concludes there is nothing to do — and
# the push step reads "no changes" as a malfunction and re-blocks the item. If
# the tests pass on the branch, the answer is `verify`, not `spec-derived`.
#
# THE ESCAPE FOR A CAPPED ITEM, since `spec-derived` is not it. An item stopped
# by the iteration cap has four routes out and only one of them is a resume:
#
#   1. Nothing at all, if the work is finished. Once the CI gate is green on the
#      branch head and QA's most recent verdict is a pass on that SAME commit,
#      the item advances to `previewed` by itself with no agent run. A finished
#      item never needs another cycle to escape a counter.
#   2. `qa-changes`, after settling the disputed criterion in the spec's FIRST
#      commit. The counter is anchored to `needs-spec`, so this does not reset
#      it — correcting the contract should not buy three more arguments about it.
#   3. `verify`, if QA was simply wrong and the implementation is fine.
#   4. `needs-spec`, which re-derives the item and does reset the counter.
#
# The cap itself counts unresolved disagreements about the SAME criterion, not
# rounds: a cycle in which the Engineer complied and QA raised something new is
# progress and costs the item nothing.
#
# Notion is not touched here and must not be. Setting a blocked item's roadmap
# row back to "Ready for factory" makes the poller create a SECOND issue for
# it, orphaning the original with all its history. The row follows the label by
# itself, via factory-notion-status.yml.

set -euo pipefail

ISSUE="${1:-}"
STAGE="${2:-}"
REPO="${GH_REPO:-jacobabuckland/motkoquote}"

usage() {
  echo "usage: $0 <issue> <needs-spec|spec-derived|verify|qa-changes>" >&2
  exit 2
}

case "$ISSUE" in
  ''|*[!0-9]*) echo "error: issue must be a number, got '${ISSUE}'." >&2; usage ;;
esac

case "$STAGE" in
  needs-spec|spec-derived|verify|qa-changes) ;;
  *) echo "error: unknown stage '${STAGE}'." >&2; usage ;;
esac

if ! gh issue view "$ISSUE" --repo "$REPO" --json number >/dev/null 2>&1; then
  echo "error: issue #${ISSUE} does not exist in ${REPO}." >&2
  exit 1
fi

STATE=$(gh issue view "$ISSUE" --repo "$REPO" --json state --jq '.state')
if [ "$STATE" != "OPEN" ]; then
  echo "error: issue #${ISSUE} is ${STATE}. Refusing to resume a closed item." >&2
  exit 1
fi

LABELS=$(gh issue view "$ISSUE" --repo "$REPO" --json labels --jq '[.labels[].name] | join(",")')
echo "#${ISSUE} labels before: ${LABELS:-none}"

# Every stage label comes off first, including the one being applied. The
# workflows trigger on the `labeled` event, so re-adding a label the issue
# already carries fires nothing at all and the item sits there looking resumed.
for L in blocked qa-disputed needs-spec spec-derived verify qa-changes; do
  case ",$LABELS," in
    *",$L,"*) gh issue edit "$ISSUE" --repo "$REPO" --remove-label "$L" >/dev/null; sleep 1 ;;
  esac
done

# One pause before the trigger: the removals above are separate API calls, and
# adding the stage label while they are still settling has produced an issue
# carrying both `blocked` and its new stage.
sleep 3
gh issue edit "$ISSUE" --repo "$REPO" --add-label "$STAGE" >/dev/null
sleep 3

echo "#${ISSUE} labels after:  $(gh issue view "$ISSUE" --repo "$REPO" --json labels --jq '[.labels[].name] | join(",")')"
echo "Triggered ${STAGE}. Watch: gh run list --repo ${REPO} --limit 5"
