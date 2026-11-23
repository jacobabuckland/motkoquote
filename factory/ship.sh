#!/usr/bin/env bash
# Usage: factory/ship.sh <id> [--no-pr]
# Commits the gated changes, pushes factory/<id>, and opens a GitHub PR with gh.
# Refuses unless gate.sh passed on exactly this diff.
. "$(dirname "$0")/lib.sh"

id="${1:-}"; require_ticket "$id"
no_pr=false; [ "${2:-}" = "--no-pr" ] && no_pr=true
wt="$(wt_path "$id")"; task="$(task_path "$id")"; branch="$(branch_name "$id")"

[ -f "$(gate_file "$id")" ] || die "gate has not passed for '$id' (run factory/gate.sh $id)"
stage_all "$wt"; now="$(cd "$wt" && git diff --cached HEAD | sha)"
[ "$now" = "$(cat "$(gate_file "$id")")" ] || die "diff changed since the gate passed: re-run factory/gate.sh $id"

title="$(head -n 1 "$task" | sed -E 's/^# Ticket [^:]*: *//')"
rounds="$(current_round "$id")"

cd "$wt"
if ! git diff --cached --quiet HEAD; then
  git commit --quiet -m "factory($id): $title" \
    -m "Built by local builder ($FACTORY_BUILDER_MODEL, $rounds round(s)); reviewed by the Claude Code owner." \
    -m "Ticket: $id"
fi
git push --quiet -u "$FACTORY_REMOTE" "$branch"
say "pushed $branch"

if [ "$no_pr" = true ]; then echo "skipped PR (--no-pr)"; exit 0; fi
command -v gh >/dev/null 2>&1 || die "gh CLI not found: install it (brew install gh) and run 'gh auth login'"

body="$LOGS_DIR/$id-pr.md"
{
  echo "## Ticket $id: $title"; echo
  awk '/^## Goal/{on=1} /^## Allowed files/{on=0} on' "$task"; echo
  echo "## Factory"
  echo "- Builder: \`$FACTORY_BUILDER_MODEL\` (local, $FACTORY_BUILDER_MODE mode), $rounds round(s)"
  echo "- Owner review: Claude Code"
  echo "- Gate: PASS"; echo
  echo "<details><summary>Gate report</summary>"; echo; cat "$LOGS_DIR/$id-gate.md"; echo; echo "</details>"
} > "$body"

existing="$(gh pr list --head "$branch" --state open --json url --jq '.[0].url' 2>/dev/null || true)"
if [ -n "$existing" ]; then
  gh pr edit "$existing" --body-file "$body" >/dev/null
  url="$existing"
else
  draft=(); [ "$FACTORY_DRAFT_PR" = true ] && draft=(--draft)
  url="$(gh pr create --base "$FACTORY_BASE_BRANCH" --head "$branch" --title "factory($id): $title" \
         --body-file "$body" ${draft[@]+"${draft[@]}"})"
fi
echo "$url" > "$TASKS_DIR/$id.pr"
say "PR: $url"

if [ "$FACTORY_AUTO_MERGE" = true ]; then
  if gh pr merge "$url" --auto --squash; then say "auto-merge enabled: GitHub merges once required checks pass"
  else say "could not enable auto-merge (turn on 'Allow auto-merge' in the repo settings)"; fi
fi
exit 0
