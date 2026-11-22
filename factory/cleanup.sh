#!/usr/bin/env bash
# Usage: factory/cleanup.sh <id> [--force]
# Removes the ticket's worktree (the branch and PR stay). --force discards uncommitted work.
. "$(dirname "$0")/lib.sh"

id="${1:-}"; validate_id "$id"
wt="$(wt_path "$id")"
cd "$REPO_ROOT"
if [ -d "$wt" ]; then
  if [ "${2:-}" = "--force" ] || [ -z "$(changed_files "$wt")" ]; then
    git worktree remove --force "$wt"   # nothing left but build artifacts (or --force given)
  else
    echo "uncommitted changes in $wt:"; changed_files "$wt" | sed 's/^/  /'
    die "not removing: ship the ticket first, or re-run with --force to discard"
  fi
  say "removed worktree $wt"
fi
git worktree prune
[ -f "$TASKS_DIR/$id.pr" ] && echo "PR: $(cat "$TASKS_DIR/$id.pr")"
mkdir -p "$TASKS_DIR/done"
for f in "$TASKS_DIR/$id".*; do [ -e "$f" ] && mv "$f" "$TASKS_DIR/done/"; done
say "archived ticket files to $TASKS_DIR/done/"
